// ── App state ─────────────────────────────────────────────────────────
let STATE = {
  raw:       null,
  fileName:  '',
  sheetName: '',
  payroll:   null,
  managers:  null,
  dedup:     null,
  history:   null,
  activeTab: 'overview',
  historyView: null,
};

document.addEventListener('DOMContentLoaded', () => {
  STATE.managers = loadManagers();
  STATE.dedup    = loadDedupRegistry();
  STATE.history  = loadHistory();
  initTabs();
  initUpload();
  renderDir();
  renderHistoryList();
  document.getElementById('mainPanel').style.display = 'none';
});

function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  STATE.activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  if (tab === 'dir')     renderDir();
  if (tab === 'history') renderHistoryList();
}

function initUpload() {
  const ua = document.getElementById('ua');
  const fi = document.getElementById('fi');
  ua.addEventListener('dragover', e => { e.preventDefault(); ua.classList.add('drag'); });
  ua.addEventListener('dragleave', () => ua.classList.remove('drag'));
  ua.addEventListener('drop', e => { e.preventDefault(); ua.classList.remove('drag'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', () => { if (fi.files[0]) loadFile(fi.files[0]); });
}

function loadFile(file) {
  STATE.fileName = file.name;
  document.getElementById('mainPanel').style.display = 'block';
  ['overviewContent','fpc','dedupContent','pvc','stc'].forEach(id => document.getElementById(id).innerHTML = '<div class="loading"><div class="spin"></div>Читаем файл…</div>');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
      STATE.sheetName = wb.SheetNames[0];
      STATE.raw = XLSX.utils.sheet_to_json(wb.Sheets[STATE.sheetName], { header: 1, defval: null, raw: true });
      runAndRender();
    } catch (err) {
      document.getElementById('overviewContent').innerHTML = `<div class="eb"><h4>Ошибка чтения файла</h4>${err.message}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function runAndRender() {
  STATE.payroll = runPayroll(STATE.raw, STATE.managers, STATE.dedup);
  renderOverview();
  renderFixedTable();
  renderDedupBlock();
  renderPreview();
  renderStructure();
  if (STATE.activeTab === 'dir') renderDir();
}

// ── Save period ───────────────────────────────────────────────────────
function savePeriodAction() {
  if (!STATE.payroll) return;
  const { meta, results, errors, fresh, dupes } = STATE.payroll;
  if (!meta.month || !meta.year) { alert('Не удалось определить период из файла.'); return; }
  fresh.forEach(row => STATE.dedup.add(buildDedupKey(row)));
  saveDedupRegistry(STATE.dedup);
  savePeriod({
    month: meta.month, year: meta.year,
    savedAt: new Date().toISOString(),
    fileName: STATE.fileName,
    summary: results.map(r => ({
      manager: r.manager, base: r.base, fixedSalary: r.fixedSalary,
      bonus: r.bonus, provizion: 0, total: r.total,
      rule: r.rule, bonusDetail: r.bonusDetail,
    })),
    errors, freshCount: fresh.length, dupeCount: dupes.length,
  });
  STATE.history = loadHistory();
  switchTab('history');
  const MONTHS = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  alert(`Период ${MONTHS[meta.month]} ${meta.year} сохранён.`);
}

// ── Overview ──────────────────────────────────────────────────────────
function renderOverview() {
  const { meta, results, errors, fresh, dupes, allRows } = STATE.payroll;
  const totFix   = results.reduce((x,r)=>x+r.fixedSalary,0);
  const totBonus = results.reduce((x,r)=>x+(r.bonus||0),0);
  const totTotal = results.reduce((x,r)=>x+(r.total||0),0);
  const MONTHS = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  document.getElementById('overviewContent').innerHTML = `
    <div class="cards">
      <div class="card"><div class="clbl">Позиций</div><div class="cval">${allRows.length}</div><div class="csub">услуги: ${allRows.filter(r=>r.isService).length}</div></div>
      <div class="card"><div class="clbl">Менеджеров</div><div class="cval">${[...new Set(fresh.map(r=>r.manager).filter(Boolean))].length}</div><div class="csub"></div></div>
      <div class="card"><div class="clbl">Получено всего</div><div class="cval cval-sm">${fmt(fresh.reduce((x,r)=>x+(r.received||0),0))}</div><div class="csub">EUR на счёт</div></div>
      <div class="card g"><div class="clbl">Фикс итого</div><div class="cval cval-sm">${fmt(totFix)}</div><div class="csub">бонус: ${fmt(totBonus)} EUR</div></div>
      <div class="card b"><div class="clbl">Итого к выплате</div><div class="cval cval-sm">${fmt(totTotal)}</div><div class="csub">${results.length} менеджер(а)</div></div>
      ${errors.length?`<div class="card r"><div class="clbl">Ошибки</div><div class="cval">${errors.length}</div><div class="csub">в расчёте</div></div>`:''}
      ${dupes.length?`<div class="card y"><div class="clbl">Дубли</div><div class="cval">${dupes.length}</div><div class="csub">исключено</div></div>`:''}
    </div>
    <div class="mbx">
      <div class="mrow"><span class="mk">Файл</span><span class="mv">${STATE.fileName}</span></div>
      <div class="mrow"><span class="mk">Период</span><span class="mv">${meta.start||'?'} — ${meta.end||'?'}</span></div>
      ${meta.fund?`<div class="mrow"><span class="mk">Фонд</span><span class="mv">${meta.fund}</span></div>`:''}
      <div class="mrow"><span class="mk">База фикса</span><span class="mv">col ${COL.goodsNoVat} "За товар без НДС"</span></div>
      <div class="mrow"><span class="mk">Дубли исключены</span><span class="mv">${dupes.length} строк из ${allRows.length}</span></div>
    </div>
    <button class="btn btn-success" onclick="savePeriodAction()">
      💾 Сохранить расчёт${meta.month?' '+MONTHS[meta.month]+' '+meta.year:''}
    </button>`;
}

// ── Fixed part table ──────────────────────────────────────────────────
function renderFixedTable() {
  const { meta, results, errors } = STATE.payroll;
  const totFix   = results.reduce((x,r)=>x+r.fixedSalary,0);
  const totBonus = results.reduce((x,r)=>x+(r.bonus||0),0);
  const totTotal = results.reduce((x,r)=>x+(r.total||0),0);
  const period   = (meta.start&&meta.end)?`${meta.start} — ${meta.end}`:'—';

  let html = `<div class="fs">
    <div><div class="fsl">Фикс итого</div><div class="fsv">${fmt(totFix)} EUR</div></div>
    <div><div class="fsl">Бонус итого</div><div class="fsv" style="color:#1e40af">${fmt(totBonus)} EUR</div></div>
    <div><div class="fsl">Провизион</div><div class="fsv" style="color:#aaa">0,00 EUR</div></div>
    <div style="border-left:2px solid #a8d8b8;padding-left:20px">
      <div class="fsl" style="font-weight:700">Итого к выплате</div>
      <div class="fsv" style="font-size:26px">${fmt(totTotal)} EUR</div>
    </div>
    <div class="fsi">${results.length} менеджер(а) · ${period}</div>
  </div>`;

  if (results.length) {
    html += `<div class="tw"><table>
      <thead><tr>
        <th>Менеджер</th><th>Режим</th><th>Группа</th><th>Тип занятости</th>
        <th style="text-align:right">База, EUR</th><th style="text-align:right">Порог</th>
        <th style="text-align:right">Фикс, EUR</th><th style="text-align:right">Бонус, EUR</th>
        <th style="text-align:right">Провизион</th><th style="text-align:right">Итого, EUR</th>
        <th>Правило / Бонус</th>
      </tr></thead>
      <tbody>
      ${results.map(r=>`<tr>
        <td><strong>${r.manager}</strong>${!r.inReport?'<br><span class="no-sales">нет продаж</span>':''}</td>
        <td>${mpill(r.mode)}</td><td>${gpill(r.group)}</td><td>${epill(r.empType)}</td>
        <td style="text-align:right" class="mono">${r.inReport?fmt(r.base):'—'}</td>
        <td style="text-align:right" class="mono">${r.threshold}</td>
        <td style="text-align:right" class="mono ${r.fixedSalary>0?'tg':'tm'}">${fmt(r.fixedSalary)}</td>
        <td style="text-align:right" class="mono ${(r.bonus||0)>0?'text-blue':'tm'}">${fmt(r.bonus||0)}</td>
        <td style="text-align:right" class="mono tm">0,00</td>
        <td style="text-align:right" class="mono fw">${fmt(r.total||0)}</td>
        <td class="mono rule-col">${r.rule}${r.bonusDetail?'<br><span class="bonus-det">'+r.bonusDetail+'</span>':''}</td>
      </tr>`).join('')}
      <tr class="total-row">
        <td colspan="6" class="total-lbl">Итого:</td>
        <td class="mono tg">${fmt(totFix)}</td>
        <td class="mono text-blue">${fmt(totBonus)}</td>
        <td class="mono tm">0,00</td>
        <td class="mono fw">${fmt(totTotal)}</td>
        <td></td>
      </tr>
      </tbody></table></div>`;
  }

  if (errors.length) {
    html += `<div class="eb" style="margin-top:14px"><h4>⚠ Ошибки / Исключения (${errors.length})</h4>
      <div class="tw"><table><thead><tr>
        <th style="background:#fff4f4;color:#c0392b">Менеджер</th>
        <th style="background:#fff4f4;color:#c0392b">Проблема</th>
        <th style="background:#fff4f4;color:#c0392b;text-align:right">База</th>
      </tr></thead><tbody>${errors.map(e=>`<tr><td>${e.manager}</td><td>${e.issue}</td>
        <td style="text-align:right" class="mono">${fmt(e.base)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  document.getElementById('fpc').innerHTML = html;
}

// ── Dedup block ───────────────────────────────────────────────────────
function renderDedupBlock() {
  const { fresh, dupes } = STATE.payroll;
  let html = `<div class="sh">Проверка дублей оплат</div>`;
  if (!dupes.length) {
    html += `<div class="ok-box">✓ Дублей не обнаружено. Все ${fresh.length} строк — новые.</div>`;
  } else {
    html += `<div class="warn-box">Обнаружено <strong>${dupes.length}</strong> дублирующихся строк — исключены из расчёта. Новых строк: <strong>${fresh.length}</strong>.</div>
    <div class="tw"><table><thead><tr>
      <th>Дата</th><th>Менеджер</th><th>Контрагент</th><th>Документ</th>
      <th style="text-align:right">Получено</th><th style="text-align:right">Товар б/НДС</th><th>Статус</th>
    </tr></thead><tbody>${dupes.slice(0,50).map(r=>`<tr>
      <td>${r.date}</td><td>${r.manager}</td><td>${r.counterpart}</td>
      <td class="mono" style="font-size:10px">${(r.document||'').substring(0,38)}…</td>
      <td style="text-align:right" class="mono">${fmt(r.received)}</td>
      <td style="text-align:right" class="mono">${fmt(r.goodsNoVat)}</td>
      <td><span class="pill pr">дубль</span></td>
    </tr>`).join('')}${dupes.length>50?`<tr><td colspan="7" style="text-align:center;color:#aaa;font-size:11px">… ещё ${dupes.length-50}</td></tr>`:''}</tbody></table></div>`;
  }
  html += `<div style="margin-top:12px;font-size:11px;color:#888">
    Ключ: дата + менеджер + контрагент + документ + суммы.
    <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="clearDedupAction()">Очистить реестр дублей</button>
  </div>`;
  document.getElementById('dedupContent').innerHTML = html;
}

function clearDedupAction() {
  if (!confirm('Очистить реестр дублей? Все строки будут считаться новыми.')) return;
  STATE.dedup = new Set();
  saveDedupRegistry(STATE.dedup);
  if (STATE.raw) runAndRender();
}

// ── Preview ───────────────────────────────────────────────────────────
function renderPreview() {
  const rows = STATE.payroll.allRows;
  const prev = rows.slice(0, 30);
  document.getElementById('pvc').innerHTML = `
    <p style="font-size:11px;color:#999;margin-bottom:8px">Первые ${prev.length} из ${rows.length} позиций.</p>
    <div class="tw"><table><thead><tr>
      <th>Тип</th><th>Дата</th><th>Менеджер</th><th>Контрагент</th><th>Артикул</th><th>Наименование</th>
      <th style="text-align:right">Получено</th><th style="text-align:right">Товар б/НДС</th>
      <th style="text-align:right">Услуги б/НДС</th><th>Документ</th>
    </tr></thead><tbody>${prev.map(r=>`<tr>
      <td><span class="pill ${r.isService?'pr':'pg'}">${r.isService?'услуга':'товар'}</span></td>
      <td>${r.date}</td><td>${r.manager}</td><td>${r.counterpart}</td>
      <td class="mono">${r.article}</td>
      <td title="${r.name}">${r.name.substring(0,24)}${r.name.length>24?'…':''}</td>
      <td style="text-align:right" class="mono">${fmt(r.received)}</td>
      <td style="text-align:right" class="mono ${!r.isService?'tg':''}">${fmt(r.goodsNoVat)}</td>
      <td style="text-align:right" class="mono">${fmt(r.serviceNoVat)}</td>
      <td style="font-size:10px">${r.docType==='bank'?'🏦 банк':'💵 касса'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ── Structure ─────────────────────────────────────────────────────────
function renderStructure() {
  const { allTypes } = STATE.payroll;
  const raw = STATE.raw;
  const groups = [
    {t:'service',l:'Служебные строки',bg:'#fffbe6',bc:'#ffe066',tc:'#7a6000'},
    {t:'header',l:'Заголовки',bg:'#eff6ff',bc:'#bfdbfe',tc:'#1e40af'},
    {t:'group',l:'Группа фонда',bg:'#f0fff4',bc:'#a8d8b8',tc:'#1a7a3a'},
    {t:'doc_bank',l:'Банк. документ',bg:'#f5f5f5',bc:'#d0d0d0',tc:'#555'},
    {t:'doc_cash',l:'ПКО',bg:'#f5f5f5',bc:'#d0d0d0',tc:'#555'},
    {t:'data',l:'Позиция данных',bg:'#fff',bc:'#e0e0e0',tc:'#333'},
    {t:'total',l:'Итоговая строка',bg:'#f5f0ff',bc:'#d0b8ff',tc:'#6a1a9a'},
  ];
  let html = '<div class="sbox">';
  groups.forEach(g => {
    const cnt = allTypes.filter(t=>t===g.t).length; if (!cnt) return;
    const idx = allTypes.findIndex(t=>t===g.t);
    const sv  = idx>=0 ? s(raw[idx][0]).substring(0,55) : '';
    html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:6px;margin-bottom:4px;background:${g.bg};border:1px solid ${g.bc}">
      <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:${g.bc};color:${g.tc};min-width:42px;text-align:center">${cnt}</span>
      <strong style="font-size:11px;color:${g.tc}">${g.l}</strong>
      ${sv?`<code style="font-size:10px;color:#888;margin-left:6px">"${sv}${sv.length===55?'…':''}"</code>`:''}</div>`;
  });
  html += '</div>';
  document.getElementById('stc').innerHTML = html;
}

// ── History ───────────────────────────────────────────────────────────
function renderHistoryList() {
  const history = STATE.history;
  const MONTHS = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const cont = document.getElementById('historyContent');
  if (!history.length) {
    cont.innerHTML = `<div style="color:#aaa;font-size:13px;padding:20px 0">Нет сохранённых периодов. Загрузите файл и нажмите «Сохранить расчёт».</div>`;
    return;
  }
  let html = '<div class="history-list">';
  history.forEach(p => {
    const key = `${p.year}-${String(p.month).padStart(2,'0')}`;
    const totFix   = p.summary.reduce((x,r)=>x+r.fixedSalary,0);
    const totBonus = p.summary.reduce((x,r)=>x+r.bonus,0);
    const totTotal = p.summary.reduce((x,r)=>x+r.total,0);
    const isOpen   = STATE.historyView === key;
    html += `<div class="hist-card ${isOpen?'hist-open':''}" onclick="viewPeriod('${key}')">
      <div class="hist-head">
        <strong>${MONTHS[p.month]} ${p.year}</strong>
        <span class="hist-date">${new Date(p.savedAt).toLocaleDateString('ru-RU')}</span>
        <button class="btn btn-danger btn-sm" onclick="deletePeriod(event,'${key}')">✕</button>
      </div>
      <div class="hist-stats">
        <span>Фикс: <strong>${fmt(totFix)} EUR</strong></span>
        <span>Бонус: <strong>${fmt(totBonus)} EUR</strong></span>
        <span>Итого: <strong class="tg">${fmt(totTotal)} EUR</strong></span>
        <span class="hist-meta">${p.summary.length} менеджер(а) · ${p.freshCount} строк · ${p.dupeCount} дублей</span>
      </div>
    </div>
    ${isOpen ? renderPeriodDetail(p) : ''}`;
  });
  html += '</div>';
  cont.innerHTML = html;
}

function viewPeriod(key) {
  STATE.historyView = STATE.historyView === key ? null : key;
  renderHistoryList();
}

function deletePeriod(e, key) {
  e.stopPropagation();
  if (!confirm('Удалить период?')) return;
  STATE.history = STATE.history.filter(h => `${h.year}-${String(h.month).padStart(2,'0')}` !== key);
  saveHistory(STATE.history);
  if (STATE.historyView === key) STATE.historyView = null;
  renderHistoryList();
}

function renderPeriodDetail(p) {
  const MONTHS = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const totFix   = p.summary.reduce((x,r)=>x+r.fixedSalary,0);
  const totBonus = p.summary.reduce((x,r)=>x+r.bonus,0);
  const totTotal = p.summary.reduce((x,r)=>x+r.total,0);
  return `<div class="period-detail">
    <div class="sh" style="margin-top:14px">Детализация: ${MONTHS[p.month]} ${p.year}</div>
    <div class="fs" style="margin-bottom:14px">
      <div><div class="fsl">Фикс</div><div class="fsv">${fmt(totFix)} EUR</div></div>
      <div><div class="fsl">Бонус</div><div class="fsv" style="color:#1e40af">${fmt(totBonus)} EUR</div></div>
      <div><div class="fsl">Провизион</div><div class="fsv" style="color:#aaa">0,00 EUR</div></div>
      <div style="border-left:2px solid #a8d8b8;padding-left:18px">
        <div class="fsl" style="font-weight:700">Итого к выплате</div>
        <div class="fsv" style="font-size:24px">${fmt(totTotal)} EUR</div>
      </div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>Менеджер</th><th style="text-align:right">База, EUR</th>
        <th style="text-align:right">Фикс</th><th style="text-align:right">Бонус</th>
        <th style="text-align:right">Провизион</th><th style="text-align:right">Итого</th><th>Правило</th></tr></thead>
      <tbody>
        ${p.summary.map(r=>`<tr>
          <td><strong>${r.manager}</strong></td>
          <td style="text-align:right" class="mono">${fmt(r.base)}</td>
          <td style="text-align:right" class="mono tg">${fmt(r.fixedSalary)}</td>
          <td style="text-align:right" class="mono text-blue">${fmt(r.bonus)}</td>
          <td style="text-align:right" class="mono tm">0,00</td>
          <td style="text-align:right" class="mono fw">${fmt(r.total)}</td>
          <td class="mono rule-col">${r.rule}${r.bonusDetail?'<br><span class="bonus-det">'+r.bonusDetail+'</span>':''}</td>
        </tr>`).join('')}
        <tr class="total-row">
          <td class="total-lbl">Итого:</td><td></td>
          <td class="mono tg">${fmt(totFix)}</td>
          <td class="mono text-blue">${fmt(totBonus)}</td>
          <td class="mono tm">0,00</td>
          <td class="mono fw">${fmt(totTotal)}</td><td></td>
        </tr>
      </tbody></table></div>
    ${p.errors&&p.errors.length?`<div class="eb" style="margin-top:10px"><h4>Ошибки (${p.errors.length})</h4>
      <ul style="padding-left:16px;font-size:12px">${p.errors.map(e=>`<li>${e.manager}: ${e.issue}</li>`).join('')}</ul></div>`:''}
  </div>`;
}

// ── Director editor ───────────────────────────────────────────────────
function renderDir() {
  const cont = document.getElementById('dirc');
  if (!cont) return;
  const mgrs = STATE.managers;

  let html = `<div class="dir-toolbar">
    <h2>⚙️ Настройки менеджеров (${mgrs.length})</h2>
    <button class="btn btn-secondary btn-sm" onclick="addManager()">+ Добавить</button>
    ${STATE.raw?`<button class="btn btn-primary btn-sm" onclick="runAndRender()">▶ Пересчитать</button>`:''}
  </div>
  <p style="font-size:11px;color:#888;margin-bottom:14px">Отредактируйте и нажмите <strong>Сохранить</strong> на карточке.</p>
  <div class="mgr-cards">`;

  mgrs.forEach((d, idx) => {
    const ini  = (d.manager_name||'').split(/\s+/).map(w=>w[0]||'').join('').toUpperCase().substring(0,2)||'?';
    const isM  = d['режим_фикса'] === 'вручную';
    const isAct = d['активен'] !== false;
    const thr  = d['минимальный_порог'];
    const thrV = (!thr && thr !== 0) ? '' : thr;
    const steps = d['бонусы'] || [];

    html += `<div class="mce" id="mcard-${idx}">
      <div class="toggle-row ${isAct?'active-on':'active-off'}">
        <span class="toggle-lbl ${isAct?'on':'off'}">${isAct?'✓ Активен':'✗ Неактивен'}</span>
        <button type="button" class="toggle-btn ${isAct?'on':'off'}" onclick="toggleActive(${idx})"></button>
      </div>
      <div class="frow full"><div class="fld"><label>Имя менеджера</label>
        <input type="text" id="f_name_${idx}" value="${eh(d.manager_name||'')}" placeholder="Имя менеджера">
      </div></div>
      <div class="frow">
        <div class="fld"><label>Режим фикса</label>
          <select id="f_mode_${idx}" onchange="onModeChange(${idx})">
            <option value="по группе" ${!isM?'selected':''}>по группе</option>
            <option value="вручную"   ${isM?'selected':''}>вручную</option>
          </select></div>
        <div class="fld" id="fe_${idx}" ${isM?'style="opacity:.4;pointer-events:none"':''}>
          <label>Тип занятости</label>
          <select id="f_emp_${idx}" ${isM?'disabled':''}>
            <option value="полная занятость"    ${d['тип_занятости']==='полная занятость'?'selected':''}>полная занятость</option>
            <option value="частичная занятость" ${d['тип_занятости']==='частичная занятость'?'selected':''}>частичная занятость</option>
          </select></div>
      </div>
      <div class="frow" id="fg_${idx}" ${isM?'style="opacity:.4;pointer-events:none"':''}>
        <div class="fld" style="grid-column:1/-1"><label>Группа фикса</label>
          <select id="f_group_${idx}" ${isM?'disabled':''}>
            <option value="удалённый менеджер"             ${d['группа_фикса']==='удалённый менеджер'?'selected':''}>удалённый менеджер</option>
            <option value="фикс независимо от поступлений" ${d['группа_фикса']==='фикс независимо от поступлений'?'selected':''}>фикс независимо от поступлений</option>
            <option value="без оклада"                     ${d['группа_фикса']==='без оклада'?'selected':''}>без оклада</option>
          </select></div>
      </div>
      <div class="frow" id="fm_${idx}" ${!isM?'style="opacity:.4;pointer-events:none"':''}>
        <div class="fld"><label>Ручной оклад (EUR)</label>
          <input type="number" id="f_sal_${idx}" value="${d['ручной_фиксированный_оклад']||''}" placeholder="напр. 650" ${!isM?'disabled':''}></div>
        <div class="fld"><label>Мин. порог (пусто=нет)</label>
          <input type="number" id="f_thr_${idx}" value="${thrV}" placeholder="нет" ${!isM?'disabled':''}></div>
      </div>
      <div class="bonus-section">
        <div class="bonus-section-hdr">
          <span>🎯 Бонусные ступени</span>
          <button type="button" class="bonus-add" onclick="addBonusStep(${idx})">+ Ступень</button>
        </div>
        ${steps.length?`<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;margin-bottom:4px;font-size:10px;color:#aaa"><span>Планка (EUR)</span><span>Бонус (EUR)</span><span></span></div>`:''}
        <div id="bonus_${idx}">${steps.map((st,si)=>`
          <div class="bonus-step">
            <input type="number" class="bp" placeholder="35000" value="${st['планка']||''}">
            <input type="number" class="bb" placeholder="200" value="${st['бонус']||''}">
            <button type="button" class="bonus-del" onclick="delBonusStep(${idx},${si})">✕</button>
          </div>`).join('')}</div>
        ${!steps.length?`<p style="font-size:11px;color:#bbb;margin-top:4px">Нет бонусных ступеней</p>`:''}
      </div>
      <div class="card-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteManager(${idx})">Удалить</button>
        <button class="btn btn-primary btn-sm" onclick="saveManager(${idx})">Сохранить</button>
      </div>
    </div>`;
  });
  html += '</div>';
  cont.innerHTML = html;
}

function onModeChange(idx) {
  const isM = document.getElementById(`f_mode_${idx}`).value === 'вручную';
  const tog = (id, dis) => {
    const el = document.getElementById(id); if (!el) return;
    el.style.opacity = dis?'0.4':'1'; el.style.pointerEvents = dis?'none':'';
    el.querySelectorAll('input,select').forEach(x=>x.disabled=dis);
  };
  tog(`fg_${idx}`,isM); tog(`fe_${idx}`,isM); tog(`fm_${idx}`,!isM);
}

function toggleActive(idx) {
  STATE.managers[idx]['активен'] = STATE.managers[idx]['активен'] === false;
  saveManagers(STATE.managers); renderDir(); if (STATE.raw) runAndRender();
}

function addBonusStep(idx) {
  if (!STATE.managers[idx]['бонусы']) STATE.managers[idx]['бонусы'] = [];
  STATE.managers[idx]['бонусы'].push({планка:'',бонус:''});
  renderDir();
}

function delBonusStep(idx, si) {
  STATE.managers[idx]['бонусы'].splice(si,1);
  saveManagers(STATE.managers); renderDir(); if (STATE.raw) runAndRender();
}

function saveManager(idx) {
  const g = id => document.getElementById(id);
  const name = g(`f_name_${idx}`)?.value?.trim();
  if (!name) { alert('Имя менеджера не может быть пустым'); return; }
  const mode = g(`f_mode_${idx}`)?.value;
  const isM  = mode === 'вручную';
  if (isM) {
    const sal = parseFloat(g(`f_sal_${idx}`)?.value);
    if (isNaN(sal)) { alert('Укажите ручной_фиксированный_оклад (число)'); return; }
  }
  const bonusRows = document.querySelectorAll(`#bonus_${idx} .bonus-step`);
  const bonuses = []; let bonusErr = false;
  bonusRows.forEach(row => {
    const pl = row.querySelector('.bp')?.value?.trim();
    const bn = row.querySelector('.bb')?.value?.trim();
    if (!pl && !bn) return;
    if (!pl||isNaN(parseFloat(pl))) { alert('Планка бонуса должна быть числом'); bonusErr=true; return; }
    if (!bn||isNaN(parseFloat(bn))) { alert('Сумма бонуса должна быть числом'); bonusErr=true; return; }
    bonuses.push({планка:parseFloat(pl),бонус:parseFloat(bn)});
  });
  if (bonusErr) return;
  const thrRaw = g(`f_thr_${idx}`)?.value?.trim();
  const thr = (!thrRaw||thrRaw==='') ? null : parseFloat(thrRaw);
  STATE.managers[idx] = {
    manager_name: name,
    активен: STATE.managers[idx]['активен'] !== false,
    режим_фикса: mode,
    группа_фикса: g(`f_group_${idx}`)?.value||'',
    тип_занятости: g(`f_emp_${idx}`)?.value||'',
    ручной_фиксированный_оклад: isM ? parseFloat(g(`f_sal_${idx}`)?.value) : null,
    минимальный_порог: isM ? thr : null,
    бонусы: bonuses,
  };
  saveManagers(STATE.managers); renderDir(); if (STATE.raw) runAndRender();
}

function addManager() {
  STATE.managers.push({manager_name:'',активен:true,режим_фикса:'по группе',группа_фикса:'удалённый менеджер',тип_занятости:'полная занятость',бонусы:[]});
  renderDir();
}

function deleteManager(idx) {
  if (!confirm(`Удалить "${STATE.managers[idx].manager_name}"?`)) return;
  STATE.managers.splice(idx,1); saveManagers(STATE.managers); renderDir(); if (STATE.raw) runAndRender();
}

// Pill helpers
const mpill = m=>m==='по группе'?`<span class="pill pb">${m}</span>`:m==='вручную'?`<span class="pill pp">${m}</span>`:`<span class="pill pgr">${m||'—'}</span>`;
const gpill = g=>g==='удалённый менеджер'?`<span class="pill py">${g}</span>`:g==='фикс независимо от поступлений'?`<span class="pill pg">${g}</span>`:g==='без оклада'?`<span class="pill pgr">${g}</span>`:`<span class="pill pgr">${g||'—'}</span>`;
const epill = e=>e==='полная занятость'?`<span class="pill pb">${e}</span>`:e==='частичная занятость'?`<span class="pill pgr">${e}</span>`:`<span class="pill pgr">${e||'—'}</span>`;
const eh    = v=>String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

// ══════════════════════════════════════════════════════════════════════
// PROVIZION MODULE — UI & State
// ══════════════════════════════════════════════════════════════════════

// Extend STATE with provizion
let PROV = {
  deals:       [],      // current session deals from JTL
  dealDedup:   null,    // loaded on first use
  settings:    null,    // loaded on first use
  filter:      'all',   // current status filter
};

function initProv() {
  PROV.dealDedup = loadDealDedup();
  PROV.settings  = loadProvSettings();
}

// ── JTL file upload handler ───────────────────────────────────────────
function initJTLUpload() {
  const ua = document.getElementById('jtl-ua');
  const fi = document.getElementById('jtl-fi');
  if (!ua || !fi) return;
  ua.addEventListener('dragover', e => { e.preventDefault(); ua.classList.add('drag'); });
  ua.addEventListener('dragleave', () => ua.classList.remove('drag'));
  ua.addEventListener('drop', e => {
    e.preventDefault(); ua.classList.remove('drag');
    if (e.dataTransfer.files[0]) loadJTLFile(e.dataTransfer.files[0]);
  });
  fi.addEventListener('change', () => { if (fi.files[0]) loadJTLFile(fi.files[0]); });
}

function loadJTLFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const result = processJTL(text, PROV.settings.excludedPlatforms, PROV.dealDedup);
    PROV.deals = result.deals;
    saveDeals(PROV.deals);
    renderProvizion();
  };
  // Try UTF-8, fallback for latin1
  reader.readAsText(file, 'UTF-8');
}

// ── Render provizion tab ──────────────────────────────────────────────
function renderProvizion() {
  const cont = document.getElementById('provContent');
  if (!cont) return;

  // Sub-tab bar
  const subTabs = [
    { key: 'all',          label: `Все (${PROV.deals.length})` },
    { key: 'auto_closed',  label: `Авто-закрытые (${PROV.deals.filter(d=>d.status===DEAL_STATUS.AUTO_CLOSED).length})` },
    { key: 'quarantine',   label: `Карантин (${PROV.deals.filter(d=>d.status===DEAL_STATUS.QUARANTINE).length})` },
    { key: 'manual_check', label: `Ручная проверка (${PROV.deals.filter(d=>d.status===DEAL_STATUS.MANUAL_CHECK).length})` },
    { key: 'excluded',     label: `Исключены (${PROV.deals.filter(d=>d.status===DEAL_STATUS.EXCLUDED).length})` },
    { key: 'duplicate',    label: `Дубли (${PROV.deals.filter(d=>d.status===DEAL_STATUS.DUPLICATE).length})` },
    { key: 'joint',        label: `Совместные (${PROV.deals.filter(d=>d.status===DEAL_STATUS.JOINT).length})` },
  ];

  let html = `
  <!-- Stats summary -->
  ${renderProvStats()}

  <!-- JTL Upload -->
  ${PROV.deals.length === 0 ? renderJTLUploadBlock() : `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <span style="font-size:12px;color:#666">Загружено ${PROV.deals.length} сделок из JTL</span>
      <label class="btn btn-secondary btn-sm" style="cursor:pointer">
        Загрузить другой файл <input type="file" id="jtl-fi2" accept=".csv,.txt" hidden>
      </label>
      <button class="btn btn-danger btn-sm" onclick="clearDeals()">Очистить реестр</button>
      <button class="btn btn-success btn-sm" onclick="registerCountedDeals()">✓ Зарегистрировать закрытые в провизионе</button>
    </div>
  `}

  <!-- Filter sub-tabs -->
  <div class="sub-tabs">
    ${subTabs.map(t=>`<button class="sub-tab ${PROV.filter===t.key?'active':''}" onclick="setProvFilter('${t.key}')">${t.label}</button>`).join('')}
  </div>

  <!-- Deals table -->
  ${renderDealsTable()}
  `;

  cont.innerHTML = html;

  // Re-attach file input for "load another"
  const fi2 = document.getElementById('jtl-fi2');
  if (fi2) fi2.addEventListener('change', () => { if (fi2.files[0]) loadJTLFile(fi2.files[0]); });

  initJTLUpload();
}

function renderJTLUploadBlock() {
  return `<div class="ua" id="jtl-ua" style="padding:24px;margin-bottom:14px">
    <div style="font-size:22px;margin-bottom:6px">📋</div>
    <p>Загрузите JTL-выгрузку (CSV)</p>
    <p class="hint">Файл экспорта заказов из JTL-Wawi</p>
    <label><input type="file" id="jtl-fi" accept=".csv,.txt" hidden><span class="bup">Выбрать CSV</span></label>
  </div>`;
}

function renderProvStats() {
  if (!PROV.deals.length) return '';
  const d = PROV.deals;
  const totAmt = d.filter(x=>x.status===DEAL_STATUS.AUTO_CLOSED||x.status===DEAL_STATUS.JOINT)
                  .reduce((s,x)=>s+(x.gesamtbetrag||0),0);
  return `<div class="cards" style="margin-bottom:14px">
    <div class="card g"><div class="clbl">Авто-закрытых</div><div class="cval">${d.filter(x=>x.status===DEAL_STATUS.AUTO_CLOSED).length}</div></div>
    <div class="card y"><div class="clbl">Карантин</div><div class="cval">${d.filter(x=>x.status===DEAL_STATUS.QUARANTINE).length}</div></div>
    <div class="card pp" style="background:#faf5ff;border-color:#d8b4fe"><div class="clbl">Ручная проверка</div><div class="cval" style="color:#6d28d9">${d.filter(x=>x.status===DEAL_STATUS.MANUAL_CHECK).length}</div></div>
    <div class="card"><div class="clbl">Исключены</div><div class="cval" style="color:#aaa">${d.filter(x=>x.status===DEAL_STATUS.EXCLUDED).length}</div></div>
    <div class="card r"><div class="clbl">Дублей</div><div class="cval">${d.filter(x=>x.status===DEAL_STATUS.DUPLICATE).length}</div></div>
    <div class="card b"><div class="clbl">Совместных</div><div class="cval">${d.filter(x=>x.status===DEAL_STATUS.JOINT).length}</div></div>
    <div class="card g"><div class="clbl">Сумма (закрытые)</div><div class="cval cval-sm">${fmt(totAmt)}</div><div class="csub">EUR брутто</div></div>
  </div>`;
}

function renderDealsTable() {
  const filterMap = {
    all:          null,
    auto_closed:  DEAL_STATUS.AUTO_CLOSED,
    quarantine:   DEAL_STATUS.QUARANTINE,
    manual_check: DEAL_STATUS.MANUAL_CHECK,
    excluded:     DEAL_STATUS.EXCLUDED,
    duplicate:    DEAL_STATUS.DUPLICATE,
    joint:        DEAL_STATUS.JOINT,
  };
  const statusFilter = filterMap[PROV.filter];
  const filtered = statusFilter ? PROV.deals.filter(d => d.status === statusFilter) : PROV.deals;

  if (!filtered.length) return `<div style="color:#aaa;font-size:13px;padding:16px 0">Нет сделок в этом фильтре.</div>`;

  return `<div class="tw"><table>
    <thead><tr>
      <th>Bestell-Nr</th><th>Datum</th><th>Verkaeufer</th><th>Firma</th>
      <th>Plattform</th><th>Land</th><th>MwSt</th>
      <th style="text-align:right">Betrag Brutto</th>
      <th>Rechnung</th><th>Lieferschein</th>
      <th>Status</th><th>Aktionen</th>
    </tr></thead>
    <tbody>${filtered.map((d, i) => {
      const origIdx = PROV.deals.indexOf(d);
      return `<tr>
        <td class="mono" style="font-size:10px">${d.bestellnummer}</td>
        <td style="font-size:11px">${d.bestelldatum}</td>
        <td>${d.verkaeufer}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.firma}">${d.firma}</td>
        <td style="font-size:11px">${d.plattform}</td>
        <td>${d.lieferland}</td>
        <td style="text-align:center">${d.mwst > 0 ? d.mwst+'%' : '<span class="tm">0%</span>'}</td>
        <td style="text-align:right" class="mono">${fmt(d.gesamtbetrag)}</td>
        <td style="font-size:10px" class="mono">${d.rechnungsnummer || '<span class="tm">—</span>'}</td>
        <td style="font-size:10px" class="mono">${d.lieferschein || (d.versanddatum ? d.versanddatum : '<span class="tm">—</span>')}</td>
        <td>${statusBadge(d.status)}<br><span style="font-size:9px;color:#aaa">${d.reason}</span></td>
        <td>${renderDealActions(d, origIdx)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  <p style="font-size:11px;color:#aaa;margin-top:6px">Показано ${filtered.length} из ${PROV.deals.length} сделок</p>`;
}

function renderDealActions(deal, idx) {
  const btns = [];

  if (deal.status === DEAL_STATUS.AUTO_CLOSED || deal.status === DEAL_STATUS.MANUAL_OK) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="openJointDialog(${idx})" title="Совместная сделка">👥</button>`);
  }
  if (deal.status === DEAL_STATUS.MANUAL_CHECK) {
    btns.push(`<button class="btn btn-primary btn-sm" onclick="markManualOK(${idx})">✓ Подтвердить</button>`);
  }
  if (deal.status === DEAL_STATUS.JOINT) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="openJointDialog(${idx})">✏️ Доли</button>`);
  }

  return btns.join(' ');
}

function setProvFilter(f) {
  PROV.filter = f;
  renderProvizion();
}

function markManualOK(idx) {
  PROV.deals[idx].status = DEAL_STATUS.MANUAL_OK;
  PROV.deals[idx].reason = 'Подтверждена вручную';
  saveDeals(PROV.deals);
  renderProvizion();
}

function clearDeals() {
  if (!confirm('Очистить реестр сделок? Данные об автосортировке будут удалены.')) return;
  PROV.deals = [];
  saveDeals(PROV.deals);
  renderProvizion();
}

function registerCountedDeals() {
  const closedDeals = PROV.deals.filter(d =>
    d.status === DEAL_STATUS.AUTO_CLOSED || d.status === DEAL_STATUS.MANUAL_OK || d.status === DEAL_STATUS.JOINT
  );
  if (!closedDeals.length) { alert('Нет закрытых сделок для регистрации.'); return; }
  closedDeals.forEach(d => {
    PROV.dealDedup.add(d.dedupKey);
    d.status = DEAL_STATUS.COUNTED;
    d.reason = 'Учтена в провизионе';
  });
  saveDealDedup(PROV.dealDedup);
  saveDeals(PROV.deals);
  alert(`Зарегистрировано ${closedDeals.length} сделок. При следующей загрузке они будут отмечены как дубли.`);
  renderProvizion();
}

// ── Joint deal dialog (inline, no modal) ─────────────────────────────
function openJointDialog(idx) {
  const deal = PROV.deals[idx];
  const existing = deal.jointDeal ? deal.jointDeal.shares : [
    { manager: deal.verkaeufer, percent: 100 }
  ];

  const sharesHtml = existing.map((s, si) =>
    `<div class="bonus-step" id="jshare-${idx}-${si}">
      <input type="text" class="js-mgr" placeholder="Менеджер" value="${s.manager||''}">
      <input type="number" class="js-pct" placeholder="%" value="${s.percent||''}" min="0" max="100">
      <button type="button" class="bonus-del" onclick="removeJShare(${idx},${si})">✕</button>
    </div>`
  ).join('');

  const dialogHtml = `<div class="joint-dialog" id="jdialog-${idx}">
    <div class="sh" style="margin-bottom:10px">👥 Совместная сделка: ${deal.bestellnummer}</div>
    <p style="font-size:11px;color:#888;margin-bottom:10px">
      Сумма: <strong>${fmt(deal.gesamtbetrag)} EUR</strong> · Сумма долей должна равняться 100%
    </p>
    <div style="display:grid;grid-template-columns:1fr 80px auto;gap:6px;margin-bottom:4px;font-size:10px;color:#aaa">
      <span>Менеджер</span><span>Доля %</span><span></span>
    </div>
    <div id="jshares-${idx}">${sharesHtml}</div>
    <button type="button" class="bonus-add" onclick="addJShare(${idx})">+ Участник</button>
    <div id="jdialog-err-${idx}" style="color:#c0392b;font-size:11px;margin-top:6px"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary btn-sm" onclick="saveJointDeal(${idx})">Сохранить</button>
      <button class="btn btn-secondary btn-sm" onclick="cancelJointDeal(${idx})">Отмена</button>
    </div>
  </div>`;

  // Insert inline after the row
  const table = document.querySelector('.tw table');
  if (!table) return;
  // Find the row — insert a full-width row after it
  const rows = table.querySelectorAll('tbody tr');
  // Remove existing dialog row if any
  const existing_dialog = document.getElementById(`jdialog-row-${idx}`);
  if (existing_dialog) { existing_dialog.remove(); return; }

  // Find the right row by data
  let targetRow = null;
  rows.forEach(r => {
    const firstCell = r.cells[0]?.textContent?.trim();
    if (firstCell === deal.bestellnummer) targetRow = r;
  });
  if (!targetRow) return;

  const newRow = document.createElement('tr');
  newRow.id = `jdialog-row-${idx}`;
  newRow.innerHTML = `<td colspan="12" style="background:#f0f4ff;padding:12px 16px">${dialogHtml}</td>`;
  targetRow.insertAdjacentElement('afterend', newRow);
}

function addJShare(idx) {
  const cont = document.getElementById(`jshares-${idx}`);
  if (!cont) return;
  const newStep = document.createElement('div');
  newStep.className = 'bonus-step';
  newStep.innerHTML = `<input type="text" class="js-mgr" placeholder="Менеджер" value="">
    <input type="number" class="js-pct" placeholder="%" value="" min="0" max="100">
    <button type="button" class="bonus-del" onclick="this.parentElement.remove()">✕</button>`;
  cont.appendChild(newStep);
}

function removeJShare(idx, si) {
  const el = document.getElementById(`jshare-${idx}-${si}`);
  if (el) el.remove();
}

function saveJointDeal(idx) {
  const cont = document.getElementById(`jshares-${idx}`);
  if (!cont) return;
  const shares = [];
  cont.querySelectorAll('.bonus-step,.bonus-step-new').forEach(row => {
    const mgr = row.querySelector('.js-mgr')?.value?.trim();
    const pct = parseFloat(row.querySelector('.js-pct')?.value);
    if (mgr && !isNaN(pct)) shares.push({ manager: mgr, percent: pct });
  });
  const v = validateJointShares(shares);
  if (!v.ok) {
    const errEl = document.getElementById(`jdialog-err-${idx}`);
    if (errEl) errEl.textContent = v.msg;
    return;
  }
  const r = applyJointDeal(PROV.deals[idx], shares);
  if (!r.ok) { const errEl = document.getElementById(`jdialog-err-${idx}`); if (errEl) errEl.textContent = r.msg; return; }
  saveDeals(PROV.deals);
  renderProvizion();
}

function cancelJointDeal(idx) {
  const row = document.getElementById(`jdialog-row-${idx}`);
  if (row) row.remove();
}

// ── Provizion settings ────────────────────────────────────────────────
function renderProvSettings() {
  const cont = document.getElementById('provSettingsContent');
  if (!cont) return;
  const s = PROV.settings;
  const allPlatforms = [...new Set([
    ...DEFAULT_PROV_SETTINGS.excludedPlatforms,
    ...PROV.deals.map(d=>d.plattform).filter(Boolean),
    ...(s.allPlatforms || []),
  ])].sort();

  let html = `<div class="sh">Настройки провизиона — исключаемые платформы</div>
    <p style="font-size:12px;color:#888;margin-bottom:14px">
      Отмеченные платформы не участвуют в расчёте провизиона. Сделки получают статус «исключена (платформа)».
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${allPlatforms.map(p => {
        const checked = s.excludedPlatforms.includes(p);
        return `<label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer">
          <input type="checkbox" ${checked?'checked':''} onchange="togglePlatform('${p}',this.checked)" style="width:16px;height:16px">
          <span>${p}</span>
          ${checked?'<span class="pill pr" style="font-size:10px">исключена</span>':'<span class="pill pg" style="font-size:10px">участвует</span>'}
        </label>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" id="newPlatformInput" placeholder="Добавить платформу..." style="border:1px solid #d0d4e0;border-radius:6px;padding:6px 10px;font-size:12px;width:220px">
      <button class="btn btn-secondary btn-sm" onclick="addPlatform()">+ Добавить</button>
    </div>
    <div style="margin-top:14px;font-size:11px;color:#aaa">
      При изменении списка перезагрузите JTL-файл, чтобы пересчитать статусы.
    </div>`;

  cont.innerHTML = html;
}

function togglePlatform(platform, excluded) {
  const s = PROV.settings;
  if (excluded) {
    if (!s.excludedPlatforms.includes(platform)) s.excludedPlatforms.push(platform);
  } else {
    s.excludedPlatforms = s.excludedPlatforms.filter(p => p !== platform);
  }
  saveProvSettings(s);
  renderProvSettings();
}

function addPlatform() {
  const input = document.getElementById('newPlatformInput');
  const val = input?.value?.trim();
  if (!val) return;
  const s = PROV.settings;
  if (!s.allPlatforms) s.allPlatforms = [];
  if (!s.allPlatforms.includes(val)) s.allPlatforms.push(val);
  saveProvSettings(s);
  input.value = '';
  renderProvSettings();
}
