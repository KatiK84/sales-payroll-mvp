const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const summaryCard = document.getElementById("summaryCard");
const tableCard = document.getElementById("tableCard");
const rowCountEl = document.getElementById("rowCount");
const colCountEl = document.getElementById("colCount");
const columnsListEl = document.getElementById("columnsList");
const previewTableEl = document.getElementById("previewTable");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");

let currentPreview = [];

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function renderColumns(columns) {
  columnsListEl.innerHTML = "";
  columns.forEach((col) => {
    const li = document.createElement("li");
    li.textContent = col;
    columnsListEl.appendChild(li);
  });
}

function renderTable(rows) {
  previewTableEl.innerHTML = "";

  if (!rows.length) {
    return;
  }

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

  previewTableEl.appendChild(thead);
  previewTableEl.appendChild(tbody);
}

function downloadPreviewJson() {
  const blob = new Blob([JSON.stringify(currentPreview, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "preview.json";
  link.click();
  URL.revokeObjectURL(url);
}

downloadJsonBtn.addEventListener("click", downloadPreviewJson);

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    setStatus("Файл не выбран.");
    return;
  }

  setStatus("Читаю файл...");

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (!rows.length) {
      setStatus("Файл прочитан, но в первом листе нет строк с данными.", "error");
      summaryCard.hidden = true;
      tableCard.hidden = true;
      return;
    }

    currentPreview = rows.slice(0, 20);

    const columns = Object.keys(rows[0]);
    rowCountEl.textContent = rows.length;
    colCountEl.textContent = columns.length;
    renderColumns(columns);
    renderTable(currentPreview);

    summaryCard.hidden = false;
    tableCard.hidden = false;
    setStatus(`Файл загружен успешно. Лист: ${firstSheetName}`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Ошибка при чтении Excel-файла.", "error");
    summaryCard.hidden = true;
    tableCard.hidden = true;
  }
});
