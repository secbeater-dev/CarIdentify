import { escapeHtml } from "../shared/utils.js?v=20260729c";

function clearTableRowHandler(container) {
  if (!container?.__tableRowClickHandler) return;
  container.removeEventListener("click", container.__tableRowClickHandler);
  delete container.__tableRowClickHandler;
}

export function renderTable(container, rows, columns, options = {}) {
  if (!container) return;
  clearTableRowHandler(container);
  container.classList.remove("is-interactive");

  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="empty">目前無資料</div>';
    return;
  }

  const getRowKey = typeof options.getRowKey === "function" ? options.getRowKey : (_, index) => index;
  const activeRowIndex = Number.isInteger(options.activeRowIndex) ? options.activeRowIndex : -1;
  const activeRowKey = options.activeRowKey === undefined || options.activeRowKey === null
    ? ""
    : String(options.activeRowKey);
  const onRowClick = typeof options.onRowClick === "function" ? options.onRowClick : null;
  const headerHtml = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("");
  const bodyHtml = rows
    .map((row, index) => {
      const rowKey = String(getRowKey(row, index));
      const isActive = activeRowIndex >= 0 ? index === activeRowIndex : activeRowKey !== "" && rowKey === activeRowKey;
      const tds = columns
        .map((col) => {
          const raw = col.format ? col.format(row[col.key], row) : row[col.key];
          return `<td>${escapeHtml(raw ?? "")}</td>`;
        })
        .join("");
      const rowClass = [
        onRowClick ? "table-row-clickable" : "",
        isActive ? "is-active" : ""
      ].filter(Boolean).join(" ");
      const classAttr = rowClass ? ` class="${rowClass}"` : "";
      return `<tr${classAttr} data-row-index="${index}" data-row-key="${escapeHtml(rowKey)}">${tds}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;

  if (!onRowClick) {
    return;
  }

  container.classList.add("is-interactive");
  const handler = (event) => {
    const rowEl = event.target.closest("tbody tr[data-row-index]");
    if (!rowEl || !container.contains(rowEl)) return;
    const index = Number(rowEl.getAttribute("data-row-index"));
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
    onRowClick(rows[index], index, rowEl.getAttribute("data-row-key") || "");
  };
  container.__tableRowClickHandler = handler;
  container.addEventListener("click", handler);
}



