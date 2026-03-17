const DEFAULT_COLUMNS = [
  'devices', 'last_updated', 'Client',
  'Labor Code', 'Other Codes', 'Parts Code',
  'Date Completed', 'Shipment Date'
];

let allHeaders = [];
let allRows = [];
let selectedColumns = new Set();
let billingData = null;
let pricingRows = [];
let pricingDirty = false;
let billingSortCol = null;
let billingSortAsc = true;

let selectedFiles = new Set();

function getFilteredRows() {
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;
  const checkedStatuses = Array.from(document.querySelectorAll('#statusChecks input:checked')).map(cb => cb.value);

  return allRows.filter(row => {
    if (selectedFiles.size > 0 && !selectedFiles.has(row._source)) return false;
    if (dateFrom || dateTo) {
      const dc = (row['Date Completed'] || '').trim().slice(0, 10);
      if (!dc) return false;
      if (dateFrom && dc < dateFrom) return false;
      if (dateTo && dc > dateTo) return false;
    }
    if (checkedStatuses.length > 0) {
      const status = (row['status'] || '').trim();
      if (!checkedStatuses.includes(status)) return false;
    }
    return true;
  });
}

async function loadAllData() {
  const res = await fetch('/api/all-data');
  const data = await res.json();
  if (data.error) { showToast(data.error, true); return; }

  allHeaders = data.headers;
  allRows = data.rows;
  selectedColumns = new Set(DEFAULT_COLUMNS.filter(c => allHeaders.includes(c)));

  selectedFiles = new Set(data.sourceFiles.map(f => f.name));
  const srcContainer = document.getElementById('sourceFiles');
  srcContainer.innerHTML = data.sourceFiles.map(f =>
    `<label class="checkbox-item">
      <input type="checkbox" value="${escapeAttr(f.name)}" checked>
      <span class="cb-label">${f.name}</span>
      <span class="cb-count">${f.rows}</span>
    </label>`
  ).join('');
  srcContainer.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedFiles.add(cb.value);
      else selectedFiles.delete(cb.value);
      applyFilters();
    });
  });

  document.getElementById('rowCount').textContent = `${data.totalRows} total rows · ${data.sourceFiles.length} file${data.sourceFiles.length > 1 ? 's' : ''}`;

  const statusContainer = document.getElementById('statusChecks');
  statusContainer.innerHTML = data.statuses.map(s =>
    `<label class="checkbox-item">
      <input type="checkbox" value="${escapeAttr(s)}">
      <span class="cb-label">${s}</span>
    </label>`
  ).join('');
  statusContainer.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', applyFilters);
  });

  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  document.getElementById('filterDateFrom').value = monthAgo.toISOString().slice(0, 10);
  document.getElementById('filterDateTo').value = today.toISOString().slice(0, 10);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('fileView').style.display = 'block';

  await applyFilters();
  renderColumns();
  renderTable();
  updateExportBtn();
  switchTab('billing');
}

async function applyFilters() {
  const filtered = getFilteredRows();

  const fc = document.getElementById('filteredCount');
  if (filtered.length !== allRows.length) {
    fc.textContent = `${filtered.length} filtered`;
    fc.style.display = '';
  } else {
    fc.style.display = 'none';
  }

  const res = await fetch('/api/billing-compute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: filtered })
  });
  billingData = await res.json();
  billingData.originalTickets = filtered.length;

  renderBilling();
  renderTable();
  renderDebug();
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('rawTab').style.display = tab === 'raw' ? 'block' : 'none';
  document.getElementById('billingTab').style.display = tab === 'billing' ? 'block' : 'none';
  document.getElementById('pricingTab').style.display = tab === 'pricing' ? 'block' : 'none';
  if (tab === 'pricing') loadPricing();
}

function isDefault(col) {
  return DEFAULT_COLUMNS.includes(col);
}

function renderColumns() {
  const defaults = allHeaders.filter(h => isDefault(h));
  const extras = allHeaders.filter(h => selectedColumns.has(h) && !isDefault(h));
  const available = allHeaders.filter(h => !selectedColumns.has(h) && !isDefault(h));

  const selectedGrid = document.getElementById('selectedGrid');
  const availableGrid = document.getElementById('availableGrid');

  selectedGrid.innerHTML =
    defaults.map(h => `<span class="col-tag default" data-col="${escapeAttr(h)}">${h}</span>`).join('') +
    extras.map(h => `<span class="col-tag selected" data-col="${escapeAttr(h)}">${h}</span>`).join('');

  availableGrid.innerHTML = available.length > 0
    ? available.map(h => `<span class="col-tag available" data-col="${escapeAttr(h)}">${h}</span>`).join('')
    : '<span style="font-size:0.8rem;color:var(--muted);">All fields selected</span>';

  selectedGrid.querySelectorAll('.col-tag.selected').forEach(tag => {
    tag.addEventListener('click', () => {
      selectedColumns.delete(tag.dataset.col);
      renderColumns(); renderTable(); updateExportBtn();
    });
  });

  availableGrid.querySelectorAll('.col-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      selectedColumns.add(tag.dataset.col);
      renderColumns(); renderTable(); updateExportBtn();
    });
  });

  document.getElementById('selectedCount').textContent = selectedColumns.size;
}

function renderTable() {
  const cols = allHeaders.filter(h => selectedColumns.has(h));
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const filtered = getFilteredRows();

  if (cols.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td style="text-align:center;color:var(--muted);padding:2rem;">Select columns to preview data</td></tr>';
    return;
  }

  thead.innerHTML = '<tr><th class="row-num-header">#</th>' + cols.map(h => `<th>${h}</th>`).join('') + '</tr>';

  const displayRows = filtered.slice(0, 200);
  tbody.innerHTML = displayRows.map((row, i) =>
    `<tr><td class="row-num">${i + 1}</td>` + cols.map(h => `<td>${escapeHtml(row[h] || '')}</td>`).join('') + '</tr>'
  ).join('');

  if (filtered.length > 200) {
    tbody.innerHTML += `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--muted);padding:1rem;">
      Showing 200 of ${filtered.length} rows
    </td></tr>`;
  }
}

function renderBilling() {
  const lines = billingData?.lines || [];
  const summary = document.getElementById('billingSummary');

  const uniqueClients = new Set(lines.map(l => l.Client));
  const totalMissing = lines.filter(l => l.Unit_Price === 'missing code/price');
  const totalValue = lines.reduce((sum, l) => {
    if (l.Line_Total === 'missing code/price') return sum;
    const p = parseFloat(l.Line_Total.replace('$', ''));
    return sum + (isNaN(p) ? 0 : p);
  }, 0);

  summary.innerHTML = `
    <div class="summary-card"><div class="label">Original Tickets</div><div class="value">${billingData?.originalTickets || 0}</div></div>
    <div class="summary-card"><div class="label">Unique Clients</div><div class="value">${uniqueClients.size}</div></div>
    <div class="summary-card"><div class="label">Total Value</div><div class="value">$${totalValue.toFixed(2)}</div></div>
    <div class="summary-card"><div class="label">Missing Prices</div><div class="value" style="color:${totalMissing.length ? '#ef4444' : '#22c55e'}">${totalMissing.length}</div></div>
    <div class="summary-card"><div class="label">Pricing Codes Loaded</div><div class="value">${billingData?.pricingCodes || 0}</div></div>
  `;

  const billingCols = ['Client', 'Code_Type', 'Code', 'Item_Name', 'Qty', 'Unit_Price', 'Line_Total'];
  const billingLabels = ['Client', 'Code Type', 'Code', 'Item Name', 'Qty', 'Unit Price', 'Line Total'];
  const thead = document.getElementById('billingHead');
  const tbody = document.getElementById('billingBody');

  thead.innerHTML = '<tr><th class="row-num-header">#</th>' + billingCols.map((col, i) => {
    const arrow = billingSortCol === col
      ? (billingSortAsc ? ' ▲' : ' ▼')
      : ' <span class="sort-hint">⇅</span>';
    return `<th class="sortable" data-col="${col}">${billingLabels[i]}${arrow}</th>`;
  }).join('') + '</tr>';

  thead.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (billingSortCol === col) billingSortAsc = !billingSortAsc;
      else { billingSortCol = col; billingSortAsc = true; }
      renderBilling();
    });
  });

  let sorted = [...lines];
  if (billingSortCol) {
    sorted.sort((a, b) => {
      let va = String(a[billingSortCol] ?? '');
      let vb = String(b[billingSortCol] ?? '');
      const na = parseFloat(va.replace(/[$,]/g, ''));
      const nb = parseFloat(vb.replace(/[$,]/g, ''));
      if (!isNaN(na) && !isNaN(nb)) return billingSortAsc ? na - nb : nb - na;
      return billingSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  tbody.innerHTML = sorted.slice(0, 500).map((row, i) =>
    `<tr><td class="row-num">${i + 1}</td>` + billingCols.map(c => {
      const val = String(row[c] ?? '');
      const cls = val === 'missing code/price' ? ' class="missing"' : '';
      return `<td${cls}>${escapeHtml(val)}</td>`;
    }).join('') + '</tr>'
  ).join('');

  if (sorted.length > 500) {
    tbody.innerHTML += `<tr><td colspan="${billingCols.length + 1}" style="text-align:center;color:var(--muted);padding:1rem;">
      Showing 500 of ${sorted.length} line items
    </td></tr>`;
  }
}

async function loadPricing() {
  const res = await fetch('/api/pricing-full');
  const data = await res.json();
  pricingRows = data.rows || [];
  pricingDirty = false;
  document.getElementById('pricingFileLabel').textContent = data.fileName || 'No pricing file';
  renderPricing();
  updateSaveBtn();
}

let pricingDragFrom = null;

function renderPricing() {
  const thead = document.getElementById('pricingHead');
  const tbody = document.getElementById('pricingBody');
  const cols = ['code', 'price', 'name', 'description'];
  const labels = ['', 'Item No.', 'Unit Price', 'Item Name', 'Description', ''];

  thead.innerHTML = '<tr><th class="row-num-header">#</th>' + labels.map(l => `<th>${l}</th>`).join('') + '</tr>';

  tbody.innerHTML = pricingRows.map((row, i) =>
    `<tr draggable="true" data-row="${i}"><td class="row-num">${i + 1}</td>` +
    `<td><span class="drag-handle" title="Drag to reorder">☰</span></td>` +
    cols.map(c =>
      `<td class="editable"><input type="text" value="${escapeAttr(row[c] || '')}" data-row="${i}" data-col="${c}"></td>`
    ).join('') +
    `<td><button class="btn-delete-row" data-row="${i}" title="Delete row">&times;</button></td>` +
    '</tr>'
  ).join('');

  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      pricingRows[parseInt(input.dataset.row)][input.dataset.col] = input.value;
      pricingDirty = true;
      updateSaveBtn();
    });
  });

  tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      pricingRows.splice(parseInt(btn.dataset.row), 1);
      pricingDirty = true;
      renderPricing();
      updateSaveBtn();
    });
  });

  tbody.querySelectorAll('tr[draggable]').forEach(tr => {
    tr.addEventListener('dragstart', e => {
      pricingDragFrom = parseInt(tr.dataset.row);
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tr.addEventListener('dragend', () => {
      pricingDragFrom = null;
      tr.classList.remove('dragging');
      tbody.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
        el.classList.remove('drag-over-above', 'drag-over-below');
      });
    });

    tr.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetRow = parseInt(tr.dataset.row);
      if (pricingDragFrom === null || targetRow === pricingDragFrom) return;

      tbody.querySelectorAll('.drag-over-above, .drag-over-below').forEach(el => {
        el.classList.remove('drag-over-above', 'drag-over-below');
      });

      if (targetRow < pricingDragFrom) {
        tr.classList.add('drag-over-above');
      } else {
        tr.classList.add('drag-over-below');
      }
    });

    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over-above', 'drag-over-below');
    });

    tr.addEventListener('drop', e => {
      e.preventDefault();
      const targetRow = parseInt(tr.dataset.row);
      if (pricingDragFrom === null || targetRow === pricingDragFrom) return;

      const item = pricingRows.splice(pricingDragFrom, 1)[0];
      pricingRows.splice(targetRow, 0, item);
      pricingDirty = true;
      pricingDragFrom = null;
      renderPricing();
      updateSaveBtn();
    });
  });
}

function updateSaveBtn() {
  const btn = document.getElementById('savePricing');
  btn.disabled = !pricingDirty;
  btn.classList.toggle('pricing-dirty', pricingDirty);
  btn.textContent = pricingDirty ? 'Save Changes *' : 'Save Changes';
}

function addPricingRow() {
  pricingRows.push({ code: '', price: '', name: '', description: '' });
  pricingDirty = true;
  renderPricing();
  updateSaveBtn();
  const tbody = document.getElementById('pricingBody');
  const lastRow = tbody.querySelector('tr:last-child');
  if (lastRow) lastRow.scrollIntoView({ behavior: 'smooth' });
  const firstInput = tbody.querySelector('tr:last-child input');
  if (firstInput) firstInput.focus();
}

async function savePricing() {
  const res = await fetch('/api/pricing-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: pricingRows })
  });
  const result = await res.json();
  if (result.error) { showToast(result.error, true); return; }
  pricingDirty = false;
  updateSaveBtn();
  showToast(`Saved ${result.savedRows} pricing rows to ${result.fileName}`);
  await applyFilters();
}

function renderDebug() {
  const section = document.getElementById('debugSection');
  const list = document.getElementById('debugList');
  const lines = billingData?.lines || [];
  const issues = [];

  const missingLines = lines.filter(l => l.Unit_Price === 'missing code/price');
  const missingCodes = [...new Set(missingLines.map(l => l.Code))];
  missingCodes.forEach(code => {
    const clients = [...new Set(missingLines.filter(l => l.Code === code).map(l => l.Client))];
    issues.push({
      type: 'error',
      label: 'Missing Code',
      msg: `"${code}" — no price found (${clients.length} client${clients.length > 1 ? 's' : ''})`
    });
  });

  const zeroLines = lines.filter(l => l.Unit_Price === '$0.00' && l.Code !== 'Shipping');
  const zeroCodes = [...new Set(zeroLines.map(l => l.Code))];
  zeroCodes.forEach(code => {
    issues.push({ type: 'warn', label: '$0 Price', msg: `"${code}" has a $0.00 unit price` });
  });

  if (issues.length === 0) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  list.innerHTML =
    `<div class="debug-count">${issues.length} issue${issues.length > 1 ? 's' : ''}</div>` +
    issues.map(i => `<div class="debug-item ${i.type}"><span class="debug-label">${i.label}</span>${escapeHtml(i.msg)}</div>`).join('');
}

function updateExportBtn() {
  const btn = document.getElementById('exportBtn');
  btn.disabled = selectedColumns.size === 0;
  btn.textContent = selectedColumns.size > 0
    ? `Export ${selectedColumns.size} Columns`
    : 'Export Selected Columns';
}

function openExportModal(mode) {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = mode === 'billing' ? 'billing' : 'columns';
  document.getElementById('exportFilename').value = `tickets_${prefix}_${today}.csv`;

  if (mode === 'billing') {
    document.getElementById('modalColumns').textContent = 'Client, Code Type, Code, Item Name, Qty, Unit Price, Line Total';
  } else {
    document.getElementById('modalColumns').textContent = [...selectedColumns].join(', ');
  }

  document.getElementById('exportModal').classList.add('open');
  document.getElementById('exportModal').dataset.mode = mode;
}

function closeExportModal() {
  document.getElementById('exportModal').classList.remove('open');
}

async function doExport() {
  const filename = document.getElementById('exportFilename').value.trim();
  if (!filename) { showToast('Enter a filename', true); return; }
  const mode = document.getElementById('exportModal').dataset.mode;
  const filtered = getFilteredRows();

  let res;
  if (mode === 'billing') {
    res = await fetch('/api/export-billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: filtered, exportName: filename })
    });
  } else {
    res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: filtered, columns: [...selectedColumns], exportName: filename })
    });
  }

  const result = await res.json();
  if (result.error) { showToast(result.error, true); return; }
  closeExportModal();
  showToast(`Exported ${result.rows} rows to ${result.exportedFile}`);
  loadExports();
}

async function loadExports() {
  const res = await fetch('/api/exports');
  const files = await res.json();
  const container = document.getElementById('exportsList');
  if (files.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;">No exports yet</div>';
    return;
  }
  container.innerHTML = files.map(f => `<div class="export-item">${f.name}</div>`).join('');
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#ef4444' : '#22c55e';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s) { return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

document.getElementById('addPricingRow').addEventListener('click', addPricingRow);
document.getElementById('savePricing').addEventListener('click', savePricing);
document.getElementById('exportBtn').addEventListener('click', () => openExportModal('columns'));
document.getElementById('exportBillingBtn').addEventListener('click', () => openExportModal('billing'));
document.getElementById('cancelExport').addEventListener('click', closeExportModal);
document.getElementById('confirmExport').addEventListener('click', doExport);
document.getElementById('exportModal').addEventListener('click', e => {
  if (e.target === document.getElementById('exportModal')) closeExportModal();
});
document.getElementById('selectAll').addEventListener('click', () => {
  selectedColumns = new Set(allHeaders);
  renderColumns(); renderTable(); updateExportBtn();
});
document.getElementById('selectNone').addEventListener('click', () => {
  selectedColumns = new Set(DEFAULT_COLUMNS.filter(c => allHeaders.includes(c)));
  renderColumns(); renderTable(); updateExportBtn();
});
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.getElementById('filterDateFrom').addEventListener('change', applyFilters);
document.getElementById('filterDateTo').addEventListener('change', applyFilters);
document.getElementById('clearFilters').addEventListener('click', () => {
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.querySelectorAll('#statusChecks input').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('#sourceFiles input').forEach(cb => {
    cb.checked = true;
    selectedFiles.add(cb.value);
  });
  applyFilters();
});

loadAllData();
loadExports();
