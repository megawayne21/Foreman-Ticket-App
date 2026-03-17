const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = 3000;

const CSV_DIR = path.join(__dirname, '..', 'CSV Import');
const EXPORT_DIR = path.join(__dirname, '..', 'Billing Exports');
const PRICING_DIR = path.join(__dirname, 'Pricing CSV');

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadPricingMap() {
  const map = {};
  if (!fs.existsSync(PRICING_DIR)) return map;
  const files = fs.readdirSync(PRICING_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(PRICING_DIR, file), 'utf-8');
    const rows = parse(content, { skip_empty_lines: true, relax_column_count: true });
    for (const row of rows) {
      const code = (row[0] || '').trim();
      if (!code || code === 'ITEM NO.') continue;
      const priceStr = (row[1] || '').replace(/[$,]/g, '').trim();
      const price = parseFloat(priceStr);
      if (code && !isNaN(price)) {
        const itemName = (row[2] || '').trim();
        map[code] = { price, name: itemName };
      }
    }
  }
  return map;
}

function findPricingFile() {
  if (!fs.existsSync(PRICING_DIR)) return null;
  const files = fs.readdirSync(PRICING_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  return files.length > 0 ? path.join(PRICING_DIR, files[0]) : null;
}

function loadAllCSVs() {
  const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
  let allRows = [];
  let headers = [];
  const sourceFiles = [];

  for (const file of csvFiles) {
    const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
    if (records.length > 0 && headers.length === 0) {
      headers = Object.keys(records[0]);
    }
    records.forEach(r => { r._source = file; });
    allRows = allRows.concat(records);
    sourceFiles.push({ name: file, rows: records.length });
  }

  const statuses = [...new Set(allRows.map(r => (r['status'] || '').trim()).filter(Boolean))].sort();

  const dates = allRows
    .map(r => (r['Date Completed'] || '').trim())
    .filter(d => d && d.match(/^\d{4}-\d{2}-\d{2}/));
  const dateMin = dates.length > 0 ? dates.reduce((a, b) => a < b ? a : b).slice(0, 10) : '';
  const dateMax = dates.length > 0 ? dates.reduce((a, b) => a > b ? a : b).slice(0, 10) : '';

  return { headers, rows: allRows, sourceFiles, statuses, dateRange: { min: dateMin, max: dateMax } };
}

app.get('/api/all-data', (req, res) => {
  try {
    const data = loadAllCSVs();
    res.json({
      headers: data.headers,
      rows: data.rows,
      totalRows: data.rows.length,
      sourceFiles: data.sourceFiles,
      statuses: data.statuses,
      dateRange: data.dateRange
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CODE_COLUMNS = ['Labor Code', 'Other Codes', 'Parts Code', 'Shipping Costs'];

function buildBillingLineItems(records, pricingMap) {
  const aggregated = {};

  for (const row of records) {
    const client = row['Client'] || '';

    for (const col of CODE_COLUMNS) {
      const raw = (row[col] || '').trim();
      if (!raw) continue;

      const dateCompleted = (row['Date Completed'] || '').trim().slice(0, 7);

      if (col === 'Shipping Costs') {
        const val = parseFloat(raw.replace(/[$,]/g, ''));
        if (!isNaN(val) && val > 0) {
          const key = `${client}||Shipping Costs||Shipping`;
          if (!aggregated[key]) {
            aggregated[key] = { Client: client, Code_Type: col, Code: 'Shipping', Item_Name: 'Shipping', Unit_Price: val, Qty: 0, totalShipping: 0, months: new Set() };
          }
          aggregated[key].Qty += 1;
          aggregated[key].totalShipping += val;
          if (dateCompleted) aggregated[key].months.add(dateCompleted);
        }
        continue;
      }

      const codes = raw.split(/[,;]+/).map(c => c.trim()).filter(Boolean);
      for (const code of codes) {
        const key = `${client}||${col}||${code}`;
        if (!aggregated[key]) {
          const entry = pricingMap[code];
          aggregated[key] = {
            Client: client,
            Code_Type: col,
            Code: code,
            Item_Name: entry ? entry.name : '',
            Unit_Price: entry ? entry.price : null,
            Qty: 0,
            months: new Set()
          };
        }
        aggregated[key].Qty += 1;
        if (dateCompleted) aggregated[key].months.add(dateCompleted);
      }
    }
  }

  return Object.values(aggregated).map(item => {
    const monthStr = [...item.months].sort().join(', ');
    if (item.Code === 'Shipping') {
      return {
        Client: item.Client,
        Month_Completed: monthStr,
        Code: item.Code,
        Item_Name: item.Item_Name,
        Qty: item.Qty,
        Unit_Price: `$${(item.totalShipping / item.Qty).toFixed(2)}`,
        Line_Total: `$${item.totalShipping.toFixed(2)}`
      };
    }
    const unitPrice = item.Unit_Price !== null ? `$${item.Unit_Price.toFixed(2)}` : 'missing code/price';
    const lineTotal = item.Unit_Price !== null ? `$${(item.Unit_Price * item.Qty).toFixed(2)}` : 'missing code/price';
    return {
      Client: item.Client,
      Month_Completed: monthStr,
      Code: item.Code,
      Item_Name: item.Item_Name,
      Qty: item.Qty,
      Unit_Price: unitPrice,
      Line_Total: lineTotal
    };
  }).filter(item => {
    if (item.Unit_Price === 'missing code/price') return true;
    const price = parseFloat(String(item.Unit_Price).replace(/[$,]/g, ''));
    return !isNaN(price) && price > 0;
  }).sort((a, b) => a.Client.localeCompare(b.Client) || a.Code.localeCompare(b.Code));
}

app.post('/api/billing-compute', (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows) return res.status(400).json({ error: 'rows required' });
    const pricingMap = loadPricingMap();
    const lines = buildBillingLineItems(rows, pricingMap);
    res.json({ lines, totalLines: lines.length, pricingCodes: Object.keys(pricingMap).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export-billing', (req, res) => {
  const { rows, exportName } = req.body;
  if (!rows) return res.status(400).json({ error: 'rows required' });

  try {
    const pricingMap = loadPricingMap();
    const lines = buildBillingLineItems(rows, pricingMap);
    const outCols = ['Client', 'Month_Completed', 'Code', 'Item_Name', 'Qty', 'Unit_Price', 'Line_Total'];
    const csv = stringify(lines, { header: true, columns: outCols });
    const outName = exportName || `billing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    const outPath = path.join(EXPORT_DIR, outName);
    fs.writeFileSync(outPath, csv);
    res.json({ success: true, exportedFile: outName, rows: lines.length, path: outPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export', (req, res) => {
  const { rows, columns, exportName } = req.body;
  if (!rows || !columns || columns.length === 0) {
    return res.status(400).json({ error: 'rows and columns are required' });
  }

  try {
    const filtered = rows.map(row => {
      const obj = {};
      columns.forEach(col => { obj[col] = row[col] ?? ''; });
      return obj;
    });
    const csv = stringify(filtered, { header: true, columns });
    const outName = exportName || `export_${new Date().toISOString().slice(0, 10)}.csv`;
    const outPath = path.join(EXPORT_DIR, outName);
    fs.writeFileSync(outPath, csv);
    res.json({ success: true, exportedFile: outName, rows: filtered.length, path: outPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pricing', (req, res) => {
  try { res.json(loadPricingMap()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pricing-full', (req, res) => {
  try {
    const filePath = findPricingFile();
    if (!filePath) return res.json({ fileName: null, rows: [] });
    const content = fs.readFileSync(filePath, 'utf-8');
    const rawRows = parse(content, { skip_empty_lines: false, relax_column_count: true });
    const rows = [];
    for (const row of rawRows) {
      const code = (row[0] || '').trim();
      if (!code || code === 'ITEM NO.') continue;
      rows.push({ code, price: (row[1] || '').trim(), name: (row[2] || '').trim(), description: (row[3] || '').trim() });
    }
    res.json({ fileName: path.basename(filePath), rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pricing-save', (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
    const filePath = findPricingFile();
    if (!filePath && !fs.existsSync(PRICING_DIR)) fs.mkdirSync(PRICING_DIR, { recursive: true });
    const outPath = filePath || path.join(PRICING_DIR, 'pricing.csv');
    const csvRows = [['ITEM NO.', 'UNIT PRICE', 'ITEM NAME', 'ITEM DESCRIPTION']];
    for (const r of rows) csvRows.push([r.code || '', r.price || '', r.name || '', r.description || '']);
    fs.writeFileSync(outPath, stringify(csvRows));
    res.json({ success: true, fileName: path.basename(outPath), savedRows: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/exports', (req, res) => {
  try {
    if (!fs.existsSync(EXPORT_DIR)) return res.json([]);
    const files = fs.readdirSync(EXPORT_DIR)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => {
        const stat = fs.statSync(path.join(EXPORT_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json(files);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Foreman Ticket App running at http://localhost:${PORT}`);
});
