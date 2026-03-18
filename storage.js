// ── Storage keys ──────────────────────────────────────────────────────
const KEYS = {
  managers:   'spm_managers',
  dedup:      'spm_dedup',      // Set of payment keys already counted
  history:    'spm_history',    // Array of saved period calculations
};

// ── Managers ──────────────────────────────────────────────────────────
function loadManagers() {
  try {
    const raw = localStorage.getItem(KEYS.managers);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_MANAGERS));
}

function saveManagers(arr) {
  localStorage.setItem(KEYS.managers, JSON.stringify(arr));
}

// ── Dedup registry ────────────────────────────────────────────────────
// Stored as array of keys (Set doesn't serialize well)
function loadDedupRegistry() {
  try {
    const raw = localStorage.getItem(KEYS.dedup);
    if (raw) return new Set(JSON.parse(raw));
  } catch(e) {}
  return new Set();
}

function saveDedupRegistry(set) {
  localStorage.setItem(KEYS.dedup, JSON.stringify([...set]));
}

// Build a dedup key for a single payment row
function buildDedupKey(row) {
  // Composite: date|manager|counterpart|docBasis|received|goodsNoVat
  const parts = [
    String(row.date || '').substring(0, 10),
    String(row.manager || '').trim(),
    String(row.counterpart || '').trim(),
    String(row.document || '').trim(),
    String(Math.round((row.received || 0) * 100)),
    String(Math.round((row.goodsNoVat || 0) * 100)),
  ];
  return parts.join('|');
}

// ── Period history ────────────────────────────────────────────────────
function loadHistory() {
  try {
    const raw = localStorage.getItem(KEYS.history);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return [];
}

function saveHistory(arr) {
  localStorage.setItem(KEYS.history, JSON.stringify(arr));
}

function savePeriod(periodData) {
  const history = loadHistory();
  // Replace existing entry for same month/year if present
  const key = `${periodData.year}-${String(periodData.month).padStart(2,'0')}`;
  const idx = history.findIndex(h => `${h.year}-${String(h.month).padStart(2,'0')}` === key);
  if (idx >= 0) history[idx] = periodData;
  else history.unshift(periodData); // newest first
  // Keep last 24 periods
  saveHistory(history.slice(0, 24));
}

function clearStorage() {
  localStorage.removeItem(KEYS.managers);
  localStorage.removeItem(KEYS.dedup);
  localStorage.removeItem(KEYS.history);
}

// ── Provizion deal registry ───────────────────────────────────────────
function loadDeals() {
  try { const r = localStorage.getItem('spm_deals'); if (r) return JSON.parse(r); } catch(e) {}
  return [];
}
function saveDeals(arr) { localStorage.setItem('spm_deals', JSON.stringify(arr)); }

// ── Deal dedup registry ───────────────────────────────────────────────
function loadDealDedup() {
  try { const r = localStorage.getItem('spm_deal_dedup'); if (r) return new Set(JSON.parse(r)); } catch(e) {}
  return new Set();
}
function saveDealDedup(set) { localStorage.setItem('spm_deal_dedup', JSON.stringify([...set])); }

// ── Provizion settings ────────────────────────────────────────────────
const DEFAULT_PROV_SETTINGS = {
  excludedPlatforms: ['Ebay-Kleinanzeigen_MGH','B-Stock','Troostwijk','Restado','Faire'],
};
function loadProvSettings() {
  try { const r = localStorage.getItem('spm_prov_settings'); if (r) return JSON.parse(r); } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_PROV_SETTINGS));
}
function saveProvSettings(obj) { localStorage.setItem('spm_prov_settings', JSON.stringify(obj)); }
