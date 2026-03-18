const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const summaryCard = document.getElementById("summaryCard");
const mappingCard = document.getElementById("mappingCard");
const tableCard = document.getElementById("tableCard");

const initialRowsEl = document.getElementById("initialRows");
const finalRowsEl = document.getElementById("finalRows");
const droppedRowsEl = document.getElementById("droppedRows");
const colCountEl = document.getElementById("colCount");
const columnsListEl = document.getElementById("columnsList");
const numericListEl = document.getElementById("numericList");
const mappingTableEl = document.getElementById("mappingTable");
const previewTableEl = document.getElementById("previewTable");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const downloadMappingBtn = document.getElementById("downloadMappingBtn");

let currentPreview = [];
let currentMapping = {};

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function normalizeColumnName(name, usedNames) {
  let value = String(name ?? "").trim().toLowerCase();
  value = value.replace(/\n/g, " ");
  value = value.replace(/\s+/g, " ");
  value = value.replace(/%/g, " percent ");
  value = value.replace(/№/g, " no ");
  value = value.replace(/[\/-]/g, " ");
  value = value.replace(/[^a-zA-Zа-яА-Я0-9_ ]/g, "");
  value = value.trim().replace(/\s+/g, "_");

  if (!value) value = "unnamed";

  const base = value;
  let counter = 2;
  while (usedNames.has(value)) {
    value = `${base}_${counter}`;
    counter += 1;
  }
  usedNames.add(value);
  return value;
}

function cleanCell(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\s+/g, " ");
    return cleaned === "" ? null : cleaned;
  }
  return value;
}

function isRowFullyEmpty(row) {
  return Object.values(row).every((value) => value === null || value === undefined || value === "");
}

function looksNumeric(value) {
  if (value === null || value === undefined || value === "") return false;
  const candidate = String(value).replaceAll(".", "").replace(",", ".").replaceAll(" ", "");
  return /^-?\d+(\.\d+)?$/.test(candidate);
}

function convertNumericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const candidate = String(value).replaceAll(".", "").replace(",", ".").replaceAll(" ", "");
  const parsed = Number(candidate);
  return Number.isNaN(parsed) ? value : parsed;
}

function detectNumericColumns(rows, columns) {
  const numericColumns = [];
  for (const col of columns) {
    const sample = rows.map((row) => row[col]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 20);
    if (!sample.length) continue;

    let count = 0;
    for (const val of sample) {
      if (looksNumeric(val)) count += 1;
    }

    if (count >= Math.max(3, Math.floor(sample.length / 2))) {
      numericColumns.push(col);
    }
  }
  return numericColumns;
}

function preprocessRows(rawRows) {
  const initialRows = rawRows.length;
  const usedNames = new Set();
  const originalColumns = rawRows.length ? Object.keys(rawRows[0]) : [];

  const columnMapping = {};
  for (const col of originalColumns) {
    columnMapping[col] = normalizeColumnName(col, usedNames);
  }

  const normalizedRows = rawRows.map((row) => {
    const newRow = {};
    for (const [oldKey, value] of Object.entries(row)) {
      newRow[columnMapping[oldKey]] = cleanCell(value);
    }
    return newRow;
  });

  const filteredRows = normalizedRows.filter((row) => !isRowFullyEmpty(row));
  const droppedEmptyRows = initialRows - filteredRows.length;

  const normalizedColumns = filteredRows.length ? Object.keys(filteredRows[0]) : Object.values(columnMapping);
  const numericColumns = detectNumericColumns(filteredRows, normalizedColumns);

  const finalRows = filteredRows.map((row, index) => {
    const converted = { report_row_id: index + 1 };
    for (const [key, value] of Object.entries(row)) {
      converted[key] = numericColumns.includes(key) ? convertNumericValue(value) : value;
    }
    return converted;
  });

  return {
    initialRows,
    droppedEmptyRows,
    finalRows,
    finalRowCount: finalRows.length,
    columnMapping,
    normalizedColumns: finalRows.length ? Object.keys(finalRows[0]) : ["report_row_id", ...normalizedColumns],
    numericColumns,
  };
}

function renderList(container, items) {
  container.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "—";
    container.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    container.appendChild(li);
  });
}

function renderPreviewTable(rows, element) {
  element.innerHTML = "";
  if (!rows.length) return;

  const columns = Object.keys(rows[0]);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      td.textContent = value === undefined || value === null ? "" : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  element.appendChild(thead);
  element.appendChild(tbody);
}

function renderMappingTable(mapping) {
  mappingTableEl.innerHTML = "";
  const entries = Object.entries(mapping);
  if (!entries.length) return;

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["Исходное название", "Нормализованное название"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  const tbody = document.createElement("tbody");
  entries.forEach(([from, to]) => {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = from;
    const td2 = document.createElement("td");
    td2.textContent = to;
    tr.appendChild(td1);
    tr.appendChild(td2);
    tbody.appendChild(tr);
  });

  mappingTableEl.appendChild(thead);
  mappingTableEl.appendChild(tbody);
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

downloadJsonBtn.addEventListener("click", () => downloadJson(currentPreview, "preview_step2.json"));
downloadMappingBtn.addEventListener("click", () => downloadJson(currentMapping, "column_mapping_step2.json"));

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    setStatus("Файл не выбран.");
    return;
  }

  setStatus("Читаю и обрабатываю файл...");

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (!rawRows.length) {
      setStatus("Файл прочитан, но в первом листе нет строк с данными.", "error");
      summaryCard.hidden = true;
      mappingCard.hidden = true;
      tableCard.hidden = true;
      return;
    }

    const processed = preprocessRows(rawRows);

    currentPreview = processed.finalRows.slice(0, 30);
    currentMapping = processed.columnMapping;

    initialRowsEl.textContent = processed.initialRows;
    finalRowsEl.textContent = processed.finalRowCount;
    droppedRowsEl.textContent = processed.droppedEmptyRows;
    colCountEl.textContent = processed.normalizedColumns.length;

    renderList(columnsListEl, processed.normalizedColumns);
    renderList(numericListEl, processed.numericColumns);
    renderMappingTable(processed.columnMapping);
    renderPreviewTable(currentPreview, previewTableEl);

    summaryCard.hidden = false;
    mappingCard.hidden = false;
    tableCard.hidden = false;
    setStatus(`Файл загружен и обработан. Лист: ${firstSheetName}`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Ошибка при чтении или обработке Excel-файла.", "error");
    summaryCard.hidden = true;
    mappingCard.hidden = true;
    tableCard.hidden = true;
  }
});
