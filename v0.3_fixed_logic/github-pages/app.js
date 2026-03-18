// Sales Payroll MVP — v0.1
// Module: File Analysis & Data Preview

// ── DOM refs ──────────────────────────────────────────────────────────────────
const fileInput  = document.getElementById('fileInput');
const uploadBox  = document.getElementById('uploadBox');
const resultsEl  = document.getElementById('results');

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Drag & Drop ───────────────────────────────────────────────────────────────
uploadBox.addEventListener('dragover', e => { e.preventDefault(); uploadBox.classList.add('dragover'); });
uploadBox.addEventListener('dragleave', ()  => uploadBox.classList.remove('dragover'));
uploadBox.addEventListener('drop', e => {
  e.preventDefault();
  uploadBox.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) processFile(fileInput.files[0]);
});

// ── Main entry point ──────────────────────────────────────────────────────────
function processFile(file) {
  resultsEl.style.display = 'block';
  showLoading();

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
      analyzeAndRender(raw, file.name, sheetName);
    } catch (err) {
      showError('Не удалось прочитать файл: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showLoading() {
  document.getElementById('overviewCards').innerHTML = '<div class="loading"><div class="spinner"></div>Читаем файл...</div>';
  ['warningsBlock','metaBlock','structureBlock','previewBlock','managersBlock']
    .forEach(id => document.getElementById(id).innerHTML = '');
}

function showError(msg) {
  document.getElementById('overviewCards').innerHTML =
    `<div class="warning-box"><h3>⚠️ Ошибка</h3><p>${msg}</p></div>`;
}

// ── Core analysis ─────────────────────────────────────────────────────────────
function analyzeAndRender(raw, fileName, sheetName) {
  const totalRows = raw.length;
  const totalCols = Math.max(...raw.map(r => r.length));

  // 1. Classify rows
  const classified = raw.map((row, i) => classifyRow(row, i));

  // 2. Extract metadata from header block
  const meta = extractMeta(raw);

  // 3. Build flat data rows
  const dataRows = buildFlatRows(raw, classified);

  // 4. Summary per manager
  const managers = aggregateByManager(dataRows);

  // ── Render ────────────────────────────────────────────────────────────────
  renderOverview(fileName, sheetName, totalRows, totalCols, classified, meta, dataRows);
  renderStructure(classified, raw);
  renderPreview(dataRows);
  renderManagers(managers, meta);
}

// ── Row classification ────────────────────────────────────────────────────────
function classifyRow(row, idx) {
  const first = str(row[0]);
  const nonNull = row.filter(v => v !== null && v !== '').length;

  if (nonNull === 0) return { type: 'empty', idx };

  // Service header rows (rows 0-4 in this report format)
  if (first.includes('Data parameters') || first.includes('Дата начала') ||
      first.includes('Дата окончания') || first.includes('Filter:')) {
    return { type: 'service', idx };
  }

  // Column header rows
  if (first === 'Фонд' || first === 'Документ' || first === 'Дата') {
    return { type: 'header', idx };
  }
  if (row.some(v => str(v) === 'Документ основание')) {
    return { type: 'header', idx };
  }

  // Total row
  if (first === 'Total' || first === 'Итого') {
    return { type: 'total', idx };
  }

  // Fund group row (short label, high sums, no date)
  if (first.match(/^0\d\s+фонд\s+/i)) {
    return { type: 'group', idx };
  }

  // Document row (payment document)
  if (first.match(/Поступление на расчетный счет\s+\d+/i) ||
      first.match(/ПКО\s+[A-Z]+\d+/i)) {
    return { type: 'document', idx, docType: detectDocType(first) };
  }

  // Data row (has a date in col 0)
  if (isDateLike(first)) {
    return { type: 'data', idx };
  }

  return { type: 'unknown', idx };
}

function detectDocType(s) {
  if (s.includes('Поступление на расчетный счет')) return 'bank';
  if (s.includes('ПКО')) return 'cash';
  return 'other';
}

function isDateLike(s) {
  return /^\d{2}\.\d{2}\.\d{4}/.test(s);
}

// ── Extract metadata ──────────────────────────────────────────────────────────
function extractMeta(raw) {
  const meta = {};
  raw.slice(0, 10).forEach(row => {
    const r = row.map(str).join(' ');
    const startMatch = r.match(/Дата начала[:\s]+(\d{2}\.\d{2}\.\d{4})/);
    const endMatch   = r.match(/Дата окончания[:\s]+(\d{2}\.\d{2}\.\d{4})/);
    if (startMatch) meta.dateStart = startMatch[1];
    if (endMatch)   meta.dateEnd   = endMatch[1];
    if (r.includes('фонд GH') || r.includes('01 фонд')) meta.fund = '01 фонд GH';
  });
  return meta;
}

// ── Build flat data rows ──────────────────────────────────────────────────────
function buildFlatRows(raw, classified) {
  const rows = [];
  let currentFund = '';
  let currentDoc = '';
  let currentDocType = '';
  let currentDocDate = '';

  for (let i = 0; i < raw.length; i++) {
    const c = classified[i];
    const row = raw[i];

    if (c.type === 'group') {
      currentFund = str(row[0]);
    }

    if (c.type === 'document') {
      currentDoc     = str(row[0]);
      currentDocType = c.docType;
      // Date is in next data row col 0
      const nextData = raw[i + 1];
      currentDocDate = nextData ? str(nextData[0]) : '';
    }

    if (c.type === 'data') {
      const date        = str(row[0]);
      const counterpart = str(row[3]);
      const manager     = str(row[4]).trim();
      const basis       = str(row[6]);
      const article     = str(row[7]);
      const name        = str(row[8]);
      const unit        = str(row[9]);
      const docBasis    = str(row[10]);
      const bankAccount = str(row[11]);
      const qty         = num(row[12]);
      const sumNoVat    = num(row[13]);
      const received    = num(row[14]);
      const goodsNoVat  = num(row[15]);
      const serviceNoVat= num(row[16]);
      const vat         = num(row[17]);
      const total       = num(row[18]);
      const diff        = num(row[19]);

      const isService = article.includes('EUPL') || serviceNoVat > 0 && goodsNoVat === 0;

      rows.push({
        fund: currentFund,
        document: currentDoc,
        docType: currentDocType,
        date,
        counterpart,
        manager,
        basis,
        article,
        name,
        unit,
        docBasis,
        bankAccount,
        qty,
        sumNoVat,
        received,
        goodsNoVat,
        serviceNoVat,
        vat,
        total,
        diff,
        isService
      });
    }
  }

  return rows;
}

// ── Aggregate by manager ──────────────────────────────────────────────────────
function aggregateByManager(rows) {
  const map = {};
  rows.forEach(r => {
    const m = r.manager || '(не указан)';
    if (!map[m]) map[m] = { name: m, rows: [], totalReceived: 0, goodsSum: 0, docs: new Set() };
    map[m].rows.push(r);
    map[m].totalReceived += r.received || 0;
    map[m].goodsSum      += r.goodsNoVat || 0;
    if (r.document) map[m].docs.add(r.document);
  });
  return Object.values(map).sort((a,b) => b.totalReceived - a.totalReceived);
}

// ── Render: Overview ──────────────────────────────────────────────────────────
function renderOverview(fileName, sheetName, totalRows, totalCols, classified, meta, dataRows) {
  const serviceRows = classified.filter(c => c.type === 'service').length;
  const headerRows  = classified.filter(c => c.type === 'header').length;
  const dataCount   = classified.filter(c => c.type === 'data').length;
  const docCount    = classified.filter(c => c.type === 'document').length;

  const managers = [...new Set(dataRows.map(r => r.manager).filter(Boolean))];
  const totalAmount = dataRows.reduce((s,r) => s + (r.received || 0), 0);

  document.getElementById('overviewCards').innerHTML = `
    <div class="card">
      <div class="card-label">Строк в файле</div>
      <div class="card-value">${totalRows}</div>
      <div class="card-sub">колонок: ${totalCols}</div>
    </div>
    <div class="card">
      <div class="card-label">Строк данных</div>
      <div class="card-value">${dataCount}</div>
      <div class="card-sub">позиций товаров/услуг</div>
    </div>
    <div class="card">
      <div class="card-label">Документов</div>
      <div class="card-value">${docCount}</div>
      <div class="card-sub">поступлений</div>
    </div>
    <div class="card">
      <div class="card-label">Менеджеров</div>
      <div class="card-value">${managers.length}</div>
      <div class="card-sub">${managers.join(', ')}</div>
    </div>
    <div class="card">
      <div class="card-label">Сумма поступлений</div>
      <div class="card-value">${fmtNum(totalAmount)}</div>
      <div class="card-sub">по расч. счёту + касса</div>
    </div>
  `;

  // Warnings
  const warnings = [];
  if (serviceRows > 0) warnings.push(`Обнаружены служебные строки заголовка (${serviceRows} шт.) — они исключены из данных`);
  if (headerRows > 0)  warnings.push(`Многоуровневый заголовок (${headerRows} строки) — колонки определены вручную по структуре отчёта`);
  const serviceItems = dataRows.filter(r => r.isService);
  if (serviceItems.length > 0) warnings.push(`Найдено ${serviceItems.length} строк услуг (артикулы EUPL и аналогичные) — помечены флагом isService для последующей очистки`);

  document.getElementById('warningsBlock').innerHTML = warnings.length ? `
    <div class="warning-box">
      <h3>⚠️ Обнаружены особенности структуры</h3>
      <ul>${warnings.map(w => `<li>${w}</li>`).join('')}</ul>
    </div>` : '';

  // Meta
  document.getElementById('metaBlock').innerHTML = `
    <div class="meta-box">
      <h3>📋 Параметры отчёта</h3>
      <div class="meta-row"><span class="meta-key">Файл</span><span class="meta-val">${fileName}</span></div>
      <div class="meta-row"><span class="meta-key">Лист</span><span class="meta-val">${sheetName}</span></div>
      ${meta.dateStart ? `<div class="meta-row"><span class="meta-key">Период начала</span><span class="meta-val">${meta.dateStart}</span></div>` : ''}
      ${meta.dateEnd   ? `<div class="meta-row"><span class="meta-key">Период окончания</span><span class="meta-val">${meta.dateEnd}</span></div>` : ''}
      ${meta.fund      ? `<div class="meta-row"><span class="meta-key">Фонд</span><span class="meta-val">${meta.fund}</span></div>` : ''}
    </div>`;
}

// ── Render: Structure ─────────────────────────────────────────────────────────
function renderStructure(classified, raw) {
  const groups = [
    { type:'service', label:'Служебные строки', badge:'badge-service', cls:'service',
      desc:'Параметры отчёта, фильтры, даты — не данные' },
    { type:'header',  label:'Заголовки колонок', badge:'badge-header', cls:'header',
      desc:'Многоуровневый заголовок (4 строки). Определены вручную.' },
    { type:'group',   label:'Группа фонда', badge:'badge-group', cls:'group',
      desc:'Строка-заголовок фонда с итоговыми суммами' },
    { type:'document',label:'Документ поступления', badge:'badge-doc', cls:'doc',
      desc:'Платёжный документ (банк или ПКО) с суммой' },
    { type:'data',    label:'Строка позиции', badge:'badge-data', cls:'data',
      desc:'Дата, контрагент, менеджер, артикул, суммы — основные данные' },
    { type:'total',   label:'Итоговая строка', badge:'badge-total', cls:'total',
      desc:'Строка Total — исключается из расчётов' },
  ];

  let html = '<div class="struct-box"><h3>Типы строк в файле</h3><div class="row-type-list">';

  groups.forEach(g => {
    const count = classified.filter(c => c.type === g.type).length;
    if (count === 0) return;
    // Show sample value
    const sample = classified.find(c => c.type === g.type);
    const sampleVal = sample ? str(raw[sample.idx][0]).substring(0, 60) : '';

    html += `
      <div class="row-type-item ${g.cls}">
        <span class="row-badge ${g.badge}">${count} строк</span>
        <div class="row-info">
          <strong>${g.label}</strong>
          <span>${g.desc}</span>
          ${sampleVal ? `<br><span style="font-family:monospace;color:#555">"${sampleVal}${sampleVal.length === 60 ? '…' : ''}"</span>` : ''}
        </div>
      </div>`;
  });

  html += '</div></div>';

  // Column map
  html += `
    <div class="struct-box">
      <h3>Определённые колонки данных</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Поле</th><th>Откуда</th></tr></thead>
          <tbody>
            ${COLUMN_MAP.map((c,i) => `<tr><td>${i}</td><td>${c.label}</td><td>${c.source}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('structureBlock').innerHTML = html;
}

const COLUMN_MAP = [
  { label:'Дата / Документ / Фонд', source:'col 0 — зависит от типа строки' },
  { label:'(служебная)', source:'col 1 — пустая' },
  { label:'(фильтр)', source:'col 2 — только в служебной строке' },
  { label:'Контрагент', source:'col 3 — строка данных' },
  { label:'Менеджер по продажам', source:'col 4 — строка данных' },
  { label:'(пустая)', source:'col 5' },
  { label:'Основание для перевода', source:'col 6' },
  { label:'Артикул номер', source:'col 7' },
  { label:'Наименование товара', source:'col 8' },
  { label:'Единица измерения', source:'col 9' },
  { label:'Документ-основание', source:'col 10' },
  { label:'Расчётный счёт', source:'col 11' },
  { label:'Количество', source:'col 12' },
  { label:'Сумма без НДС (по документу)', source:'col 13' },
  { label:'Получено на расчётный счёт', source:'col 14' },
  { label:'За товар без НДС', source:'col 15' },
  { label:'За услуги без НДС', source:'col 16' },
  { label:'Сумма НДС', source:'col 17' },
  { label:'Итого', source:'col 18' },
  { label:'Разница', source:'col 19' },
];

// ── Render: Preview ───────────────────────────────────────────────────────────
function renderPreview(dataRows) {
  const preview = dataRows.slice(0, 30);
  const html = `
    <p style="margin-bottom:12px;color:#888;font-size:0.85rem">
      Показаны первые ${preview.length} из ${dataRows.length} строк позиций.
      <span style="background:#ffd0d0;padding:2px 6px;border-radius:4px;font-size:0.78rem;margin-left:8px">🔴 услуга</span>
      <span style="background:#d0ffd8;padding:2px 6px;border-radius:4px;font-size:0.78rem;margin-left:4px">🟢 товар</span>
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Тип</th><th>Дата</th><th>Менеджер</th><th>Контрагент</th>
            <th>Артикул</th><th>Наименование</th><th>Кол-во</th>
            <th>Получено</th><th>За товар</th><th>За услуги</th><th>Тип документа</th>
          </tr>
        </thead>
        <tbody>
          ${preview.map(r => `
            <tr>
              <td><span class="badge-small" style="${r.isService ? 'background:#ffd0d0;color:#c00' : 'background:#d0ffd8;color:#060'}">${r.isService ? 'услуга' : 'товар'}</span></td>
              <td>${r.date}</td>
              <td>${r.manager}</td>
              <td>${r.counterpart}</td>
              <td style="font-family:monospace">${r.article}</td>
              <td title="${r.name}">${r.name.substring(0,35)}${r.name.length>35?'…':''}</td>
              <td style="text-align:right">${r.qty ?? ''}</td>
              <td style="text-align:right">${fmtNum(r.received)}</td>
              <td style="text-align:right">${fmtNum(r.goodsNoVat)}</td>
              <td style="text-align:right">${fmtNum(r.serviceNoVat)}</td>
              <td>${r.docType === 'bank' ? '🏦 банк' : r.docType === 'cash' ? '💵 касса' : r.docType}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('previewBlock').innerHTML = html;
}

// ── Render: Managers ──────────────────────────────────────────────────────────
function renderManagers(managers, meta) {
  const period = meta.dateStart && meta.dateEnd
    ? `${meta.dateStart} — ${meta.dateEnd}`
    : 'период из файла';

  let html = `<p style="margin-bottom:16px;color:#888;font-size:0.85rem">Период: ${period} | Сводка по поступлениям на расчётный счёт</p>`;

  managers.forEach(m => {
    const initials = m.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().substring(0, 2);
    const goodsOnly = m.rows.filter(r => !r.isService).reduce((s,r) => s + (r.received || 0), 0);
    const docsCount = m.docs.size;
    const rowsCount = m.rows.length;

    html += `
      <div class="manager-card">
        <div class="manager-avatar">${initials}</div>
        <div class="manager-info">
          <h3>${m.name}</h3>
          <p>${rowsCount} позиций · ${docsCount} документов</p>
        </div>
        <div class="manager-stats">
          <div class="manager-amount">${fmtNum(m.totalReceived)}</div>
          <div class="manager-docs">всего получено</div>
          <div class="manager-docs" style="margin-top:4px">товар без услуг: ${fmtNum(goodsOnly)}</div>
        </div>
      </div>`;
  });

  document.getElementById('managersBlock').innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function fmtNum(v) {
  if (!v || v === 0) return '—';
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
