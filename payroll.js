// ── Helpers ───────────────────────────────────────────────────────────
function excelDateToStr(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  const dd = String(d.getUTCDate()).padStart(2,'0');
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

const s = v => {
  if (v == null) return '';
  if (typeof v === 'number' && v > 40000 && v < 70000) return excelDateToStr(v);
  return String(v).trim();
};
const n = v => {
  if (v == null || v === '') return 0;
  const x = parseFloat(String(v).replace(',','.'));
  return isNaN(x) ? 0 : x;
};
const fmt = v => {
  if (!v && v !== 0) return '—';
  if (v === 0) return '0,00';
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── Row classification ────────────────────────────────────────────────
function classifyRow(row) {
  const f = s(row[0]);
  const nn = row.filter(v => v !== null && v !== '').length;
  if (nn === 0) return 'empty';
  if (f.includes('Data parameters') || f.includes('Дата начала') ||
      f.includes('Дата окончания') || f.includes('Filter:')) return 'service';
  if (f === 'Фонд' || f === 'Документ' || f === 'Дата') return 'header';
  if (row.some(v => s(v) === 'Документ основание')) return 'header';
  if (f === 'Total' || f === 'Итого') return 'total';
  if (/^0\d\s+фонд\s+/i.test(f)) return 'group';
  if (/Поступление на расчетный счет\s+\d+/i.test(f)) return 'doc_bank';
  if (/ПКО\s+[A-Z]+\d+/i.test(f)) return 'doc_cash';
  if (/^\d{2}\.\d{2}\.\d{4}/.test(f)) return 'data';
  return 'unknown';
}

function extractMeta(raw) {
  const m = {};
  raw.slice(0, 10).forEach(row => {
    const r = row.map(s).join(' ');
    const a = r.match(/Дата начала[:\s]+(\d{2}\.\d{2}\.\d{4})/);
    const b = r.match(/Дата окончания[:\s]+(\d{2}\.\d{2}\.\d{4})/);
    if (a) m.start = a[1];
    if (b) m.end = b[1];
    if (r.includes('фонд GH')) m.fund = '01 фонд GH';
  });
  // Auto-detect month/year from start date
  if (m.start) {
    const parts = m.start.split('.');
    m.month = parseInt(parts[1], 10);
    m.year  = parseInt(parts[2], 10);
  }
  return m;
}

// ── Build flat data rows from raw XLSX ───────────────────────────────
function buildDataRows(raw) {
  const rows = [];
  let fund = '', doc = '', docType = '';
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i], t = classifyRow(row);
    if (t === 'group')    { fund = s(row[0]); }
    if (t === 'doc_bank') { doc = s(row[0]); docType = 'bank'; }
    if (t === 'doc_cash') { doc = s(row[0]); docType = 'cash'; }
    if (t === 'data') {
      const art     = s(row[COL.article]);
      const svcNoVat = n(row[COL.serviceNoVat]);
      const gdsNoVat = n(row[COL.goodsNoVat]);
      rows.push({
        fund, document: doc, docType,
        date:         s(row[COL.date]),
        counterpart:  s(row[COL.counterpart]),
        manager:      s(row[COL.manager]),
        article:      art,
        name:         s(row[COL.name]),
        qty:          n(row[COL.qty]),
        received:     n(row[COL.received]),
        goodsNoVat:   gdsNoVat,
        serviceNoVat: svcNoVat,
        isService:    art.includes('EUPL') || (svcNoVat > 0 && gdsNoVat === 0),
      });
    }
  }
  return rows;
}

// ── Deduplication ─────────────────────────────────────────────────────
function deduplicateRows(rows, dedupRegistry) {
  const fresh = [], dupes = [];
  const sessionKeys = new Set(); // track within this file too

  rows.forEach(row => {
    const key = buildDedupKey(row);
    if (dedupRegistry.has(key) || sessionKeys.has(key)) {
      dupes.push({ ...row, dedupKey: key });
    } else {
      sessionKeys.add(key);
      fresh.push({ ...row, dedupKey: key });
    }
  });
  return { fresh, dupes };
}

// ── Aggregate by manager ──────────────────────────────────────────────
function aggregateByManager(rows) {
  const m = {};
  rows.forEach(r => {
    const k = r.manager || '(не указан)';
    if (!m[k]) m[k] = { name: k, rows: [], totalReceived: 0, goodsSum: 0, docs: new Set() };
    m[k].rows.push(r);
    m[k].totalReceived += r.received || 0;
    m[k].goodsSum      += r.goodsNoVat || 0;
    if (r.document) m[k].docs.add(r.document);
  });
  return Object.values(m).sort((a, b) => b.totalReceived - a.totalReceived);
}

// ── Fixed salary rules ────────────────────────────────────────────────
function calcFixed(entry, base) {
  const mode = entry['режим_фикса'];
  if (!mode) return { fixed: 0, rule: 'Не указан режим_фикса', isErr: true };

  if (mode === 'вручную') {
    const sal = entry['ручной_фиксированный_оклад'];
    if (sal === undefined || sal === null || sal === '')
      return { fixed: 0, rule: 'вручную: не указан ручной_фиксированный_оклад', isErr: true };
    const sn = parseFloat(sal);
    if (isNaN(sn)) return { fixed: 0, rule: 'вручную: оклад не число', isErr: true };
    const thr = entry['минимальный_порог'];
    const hasThr = thr !== null && thr !== undefined && thr !== '' && thr !== 'нет';
    if (hasThr) {
      const tn = parseFloat(thr);
      if (isNaN(tn)) return { fixed: 0, rule: 'вручную: порог не число', isErr: true };
      return base >= tn
        ? { fixed: sn, rule: `вручную: ${sn}, порог ${fmt(tn)} → выплачено`, isErr: false }
        : { fixed: 0,  rule: `вручную: ${sn}, порог ${fmt(tn)} → не достигнут (${fmt(base)})`, isErr: false };
    }
    return { fixed: sn, rule: `вручную: ${sn}, порог нет → выплачено`, isErr: false };
  }

  if (mode === 'по группе') {
    const g = entry['группа_фикса'], et = entry['тип_занятости'];
    if (!g) return { fixed: 0, rule: 'по группе: не указана группа_фикса', isErr: true };
    if (!et && g !== 'без оклада')
      return { fixed: 0, rule: 'по группе: не указан тип_занятости', isErr: true };

    if (g === 'без оклада') return { fixed: 0, rule: 'без оклада → 0', isErr: false };

    if (g === 'фикс независимо от поступлений') {
      if (et === 'полная занятость')    return { fixed: 800, rule: 'фикс всегда, полная занятость → 800', isErr: false };
      if (et === 'частичная занятость') return { fixed: 400, rule: 'фикс всегда, частичная занятость → 400', isErr: false };
      return { fixed: 0, rule: `неизвестный тип_занятости: "${et}"`, isErr: true };
    }

    if (g === 'удалённый менеджер') {
      if (et === 'полная занятость')
        return base >= 10000
          ? { fixed: 800, rule: `полная занятость ≥ 10 000 → 800`, isErr: false }
          : { fixed: 400, rule: `полная занятость < 10 000 → 400 (база: ${fmt(base)})`, isErr: false };
      if (et === 'частичная занятость')
        return base >= 5000
          ? { fixed: 400, rule: `частичная занятость ≥ 5 000 → 400`, isErr: false }
          : { fixed: 200, rule: `частичная занятость < 5 000 → 200 (база: ${fmt(base)})`, isErr: false };
      return { fixed: 0, rule: `неизвестный тип_занятости: "${et}"`, isErr: true };
    }

    return { fixed: 0, rule: `неизвестная группа_фикса: "${g}"`, isErr: true };
  }

  return { fixed: 0, rule: `неизвестный режим_фикса: "${mode}"`, isErr: true };
}

// ── Bonus rules ───────────────────────────────────────────────────────
function calcBonus(entry, base) {
  const steps = entry['бонусы'];
  if (!steps || !Array.isArray(steps) || steps.length === 0)
    return { bonus: 0, detail: '', bonusSteps: [], errs: [] };

  const errs = [], bonusSteps = [];
  let total = 0;

  steps.forEach((step, i) => {
    const pl = parseFloat(step['планка']);
    const bn = parseFloat(step['бонус']);
    if (isNaN(pl)) { errs.push(`ступень ${i+1}: планка не число`); return; }
    if (isNaN(bn)) { errs.push(`ступень ${i+1}: бонус не число`);  return; }
    const reached = base >= pl;
    bonusSteps.push({ планка: pl, бонус: bn, reached });
    if (reached) total += bn;
  });

  const detail = bonusSteps.filter(s => s.reached)
    .map(s => `${fmt(s.планка)} → +${fmt(s.бонус)}`).join('; ');

  return { bonus: total, detail, bonusSteps, errs };
}

// ── Main payroll calculation ──────────────────────────────────────────
function runPayroll(raw, managers, dedupRegistry) {
  const allTypes  = raw.map(r => classifyRow(r));
  const meta      = extractMeta(raw);
  const allRows   = buildDataRows(raw);

  // Dedup
  const { fresh, dupes } = deduplicateRows(allRows, dedupRegistry);

  // Aggregate fresh rows only
  const agg = aggregateByManager(fresh.filter(r => !r.isService));
  const inReport = new Set(agg.map(m => m.name.trim()));

  const results = [], errors = [];

  // Process managers present in report
  agg.forEach(m => {
    const entry = managers.find(d => d.manager_name.trim() === m.name.trim());
    if (!entry) {
      errors.push({ manager: m.name, issue: 'Не найден в справочнике менеджеров', base: m.goodsSum });
      return;
    }
    if (entry['активен'] === false) return;

    const fr = calcFixed(entry, m.goodsSum);
    if (fr.isErr) { errors.push({ manager: m.name, issue: fr.rule, base: m.goodsSum }); return; }

    const br = calcBonus(entry, m.goodsSum);
    br.errs.forEach(e => errors.push({ manager: m.name, issue: 'Бонус: ' + e, base: m.goodsSum }));

    const thr = entry['минимальный_порог'];
    const td  = (!thr && thr !== 0) ? 'нет' : fmt(parseFloat(thr));

    results.push({
      manager:      m.name,
      mode:         entry['режим_фикса'] || '—',
      group:        entry['группа_фикса'] || '—',
      empType:      entry['тип_занятости'] || '—',
      base:         m.goodsSum,
      received:     m.totalReceived,
      threshold:    td,
      fixedSalary:  fr.fixed,
      bonus:        br.bonus,
      bonusDetail:  br.detail,
      bonusSteps:   br.bonusSteps,
      provizion:    0,
      total:        fr.fixed + br.bonus,
      rule:         fr.rule,
      rows:         m.rows,
      inReport:     true,
    });
  });

  // Active managers not in report (base = 0) — still get fixed salary if applicable
  managers.forEach(entry => {
    if (entry['активен'] === false) return;
    if (!entry.manager_name || !entry.manager_name.trim()) return;
    if (inReport.has(entry.manager_name.trim())) return;

    const fr = calcFixed(entry, 0);
    if (fr.isErr) { errors.push({ manager: entry.manager_name, issue: fr.rule + ' (нет в отчёте)', base: 0 }); return; }
    if (fr.fixed === 0) return;

    const thr = entry['минимальный_порог'];
    const td  = (!thr && thr !== 0) ? 'нет' : fmt(parseFloat(thr));

    results.push({
      manager:      entry.manager_name,
      mode:         entry['режим_фикса'] || '—',
      group:        entry['группа_фикса'] || '—',
      empType:      entry['тип_занятости'] || '—',
      base:         0,
      received:     0,
      threshold:    td,
      fixedSalary:  fr.fixed,
      bonus:        0,
      bonusDetail:  '',
      bonusSteps:   [],
      provizion:    0,
      total:        fr.fixed,
      rule:         fr.rule + ' (нет продаж в периоде)',
      rows:         [],
      inReport:     false,
    });
  });

  return { meta, allTypes, allRows, fresh, dupes, results, errors };
}
