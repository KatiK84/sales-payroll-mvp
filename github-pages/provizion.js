// ══════════════════════════════════════════════════════════════════════
// PROVIZION MODULE — JTL Pipeline
// ══════════════════════════════════════════════════════════════════════

// ── JTL column mapping ────────────────────────────────────────────────
const JTL_COL = {
  bestellnummer:   'Bestellnummer',
  bestelldatum:    'Bestelldatum',
  rechnungsnummer: 'Rechnungsnummer',
  rechnungsdatum:  'Rechnungsdatum',
  firma:           'Firma',
  nachname:        'Nachname',
  vorname:         'Vorname',
  lieferschein:    'Lieferschein',
  versanddatum:    'Versanddatum',
  versandart:      'Versandart',
  lieferland:      'Lieferland',
  zahlungsart:     'Zahlungsart',
  kundengruppe:    'Kundengruppe',
  plattformen:     'Plattformen',
  verkaeufer:      'Verkaeufer',
  mwst:            'MwSt',
  gesamtbetrag:    'Gesamtbetrag_Brutto',
};

// ── Statuses ──────────────────────────────────────────────────────────
const DEAL_STATUS = {
  NEW:           'новая',
  OPEN:          'незакрытая',
  AUTO_CLOSED:   'автоматически_закрыта',
  QUARANTINE:    'карантин',
  MANUAL_CHECK:  'ожидает_ручной_проверки',
  MANUAL_OK:     'подтверждена_вручную',
  EXCLUDED:      'исключена_по_платформе',
  DUPLICATE:     'дубль',
  JOINT:         'совместная',
  COUNTED:       'учтена_в_провизионе',
};

// ── Parse JTL CSV ─────────────────────────────────────────────────────
function parseJTLCsv(text) {
  // Detect delimiter: semicolon or comma
  const firstLine = text.split('\n')[0] || '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const rows = [];
  const lines = text.split('\n');
  if (!lines.length) return rows;

  // Parse header
  const header = splitCsvLine(lines[0], delim).map(h => h.trim().replace(/^["']|["']$/g,''));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitCsvLine(line, delim).map(v => v.replace(/^["']|["']$/g,'').trim());
    const obj = {};
    header.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }
  return { header, rows };
}

function splitCsvLine(line, delim) {
  const result = [];
  let current = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === delim && !inQuote) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ── Build dedup key for a JTL row ─────────────────────────────────────
function buildJTLDedupKey(row) {
  const b = (row[JTL_COL.bestellnummer] || '').trim();
  const r = (row[JTL_COL.rechnungsnummer] || '').trim();
  const v = (row[JTL_COL.verkaeufer] || '').trim();
  return `${b}|${r}|${v}`;
}

// ── Classify a single JTL row ─────────────────────────────────────────
function classifyJTLRow(row, excludedPlatforms, dealDedupRegistry) {
  const platform   = (row[JTL_COL.plattformen] || '').trim();
  const mwst       = parseMwSt(row[JTL_COL.mwst] || '');
  const rechnung   = (row[JTL_COL.rechnungsnummer] || '').trim();
  const lieferschein = (row[JTL_COL.lieferschein] || '').trim();
  const versanddatum = (row[JTL_COL.versanddatum] || '').trim();
  const dedupKey   = buildJTLDedupKey(row);

  // 1. Dedup check
  if (dealDedupRegistry.has(dedupKey)) {
    return { status: DEAL_STATUS.DUPLICATE, reason: 'Дубль: уже учтена ранее', dedupKey };
  }

  // 2. Platform exclusion
  if (excludedPlatforms.includes(platform)) {
    return { status: DEAL_STATUS.EXCLUDED, reason: `Платформа исключена: ${platform}`, dedupKey };
  }

  // 3. MwSt = 0 → manual check required
  if (mwst === 0) {
    return { status: DEAL_STATUS.MANUAL_CHECK, reason: 'MwSt = 0 → требует ручной проверки документов', dedupKey };
  }

  // 4. MwSt > 0 — check closing documents
  const hasRechnung    = rechnung !== '';
  const hasDelivery    = lieferschein !== '' || versanddatum !== '';

  if (hasRechnung && hasDelivery) {
    return { status: DEAL_STATUS.AUTO_CLOSED, reason: 'Rechnung + Lieferschein/Versanddatum → авто-закрыта', dedupKey };
  }

  // Quarantine: MwSt > 0 but missing docs
  let missingDocs = [];
  if (!hasRechnung)  missingDocs.push('Rechnungsnummer');
  if (!hasDelivery)  missingDocs.push('Lieferschein / Versanddatum');
  return { status: DEAL_STATUS.QUARANTINE, reason: `Карантин: нет ${missingDocs.join(', ')}`, dedupKey };
}

function parseMwSt(val) {
  if (!val) return 0;
  // Accept "19%", "19,00%", "0", "19.00", etc.
  const cleaned = String(val).replace(/%/g,'').replace(',','.').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ── Process full JTL file ─────────────────────────────────────────────
function processJTL(csvText, excludedPlatforms, dealDedupRegistry) {
  const parsed = parseJTLCsv(csvText);
  if (!parsed || !parsed.rows) return { deals: [], stats: {}, header: [] };

  const deals = [];
  const stats = {
    total: 0,
    auto_closed: 0,
    quarantine: 0,
    manual_check: 0,
    excluded: 0,
    duplicate: 0,
  };

  // Session dedup within this file
  const sessionKeys = new Set();

  parsed.rows.forEach((row, i) => {
    const bestellnr = (row[JTL_COL.bestellnummer] || '').trim();
    if (!bestellnr) return; // skip empty rows

    const dedupKey = buildJTLDedupKey(row);
    // Session-level dedup (same file)
    const isDupeInSession = sessionKeys.has(dedupKey);
    if (!isDupeInSession) sessionKeys.add(dedupKey);

    const classification = classifyJTLRow(
      row,
      excludedPlatforms,
      isDupeInSession ? new Set([dedupKey, ...dealDedupRegistry]) : dealDedupRegistry
    );

    const mwst = parseMwSt(row[JTL_COL.mwst] || '');
    const deal = {
      id:            `jtl_${i}`,
      bestellnummer: bestellnr,
      rechnungsnummer: (row[JTL_COL.rechnungsnummer] || '').trim(),
      bestelldatum:  (row[JTL_COL.bestelldatum] || '').trim(),
      rechnungsdatum:(row[JTL_COL.rechnungsdatum] || '').trim(),
      firma:         (row[JTL_COL.firma] || '').trim(),
      verkaeufer:    (row[JTL_COL.verkaeufer] || '').trim(),
      lieferland:    (row[JTL_COL.lieferland] || '').trim(),
      plattform:     (row[JTL_COL.plattformen] || '').trim(),
      zahlungsart:   (row[JTL_COL.zahlungsart] || '').trim(),
      lieferschein:  (row[JTL_COL.lieferschein] || '').trim(),
      versanddatum:  (row[JTL_COL.versanddatum] || '').trim(),
      mwst,
      gesamtbetrag:  parseFloat((row[JTL_COL.gesamtbetrag] || '0').replace(',','.')),
      status:        classification.status,
      reason:        classification.reason,
      dedupKey:      classification.dedupKey,
      jointDeal:     null,  // {shares: [{manager, percent}]}
      manualDocs:    {},    // for manual check docs
    };

    deals.push(deal);
    stats.total++;
    if (deal.status === DEAL_STATUS.AUTO_CLOSED)  stats.auto_closed++;
    if (deal.status === DEAL_STATUS.QUARANTINE)   stats.quarantine++;
    if (deal.status === DEAL_STATUS.MANUAL_CHECK) stats.manual_check++;
    if (deal.status === DEAL_STATUS.EXCLUDED)     stats.excluded++;
    if (deal.status === DEAL_STATUS.DUPLICATE)    stats.duplicate++;
  });

  return { deals, stats, header: parsed.header };
}

// ── Joint deal helpers ────────────────────────────────────────────────
function validateJointShares(shares) {
  if (!shares || !shares.length) return { ok: false, msg: 'Нет участников' };
  const total = shares.reduce((x, s) => x + (parseFloat(s.percent) || 0), 0);
  if (Math.abs(total - 100) > 0.01) return { ok: false, msg: `Сумма долей = ${total.toFixed(1)}%, должно быть 100%` };
  return { ok: true, msg: '' };
}

function applyJointDeal(deal, shares) {
  const v = validateJointShares(shares);
  if (!v.ok) return { ok: false, msg: v.msg };
  deal.jointDeal = { shares };
  deal.status = DEAL_STATUS.JOINT;
  return { ok: true, msg: '' };
}

// ── Status label + color ──────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    [DEAL_STATUS.AUTO_CLOSED]:  { cls: 'pill pg',  label: 'авто-закрыта' },
    [DEAL_STATUS.QUARANTINE]:   { cls: 'pill py',  label: 'карантин' },
    [DEAL_STATUS.MANUAL_CHECK]: { cls: 'pill pp',  label: 'ручная проверка' },
    [DEAL_STATUS.MANUAL_OK]:    { cls: 'pill pg',  label: 'подтверждена вручную' },
    [DEAL_STATUS.EXCLUDED]:     { cls: 'pill pgr', label: 'исключена (платформа)' },
    [DEAL_STATUS.DUPLICATE]:    { cls: 'pill pr',  label: 'дубль' },
    [DEAL_STATUS.JOINT]:        { cls: 'pill pb',  label: 'совместная' },
    [DEAL_STATUS.COUNTED]:      { cls: 'pill tg',  label: 'учтена' },
    [DEAL_STATUS.NEW]:          { cls: 'pill pgr', label: 'новая' },
    [DEAL_STATUS.OPEN]:         { cls: 'pill py',  label: 'незакрытая' },
  };
  const d = map[status] || { cls: 'pill pgr', label: status };
  return `<span class="${d.cls}">${d.label}</span>`;
}
