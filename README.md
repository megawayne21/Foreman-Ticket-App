# Megawatt Ticket Billing Tool

Internal tool for viewing Foreman ticket data, computing billing line items from pricing codes, and exporting results to CSV.

## Folder Structure

```
Foreman Ticket App/
├── App/                   # Application source
│   ├── server.js          # Express backend
│   ├── public/            # Frontend (HTML, JS, logo)
│   └── Pricing CSV/       # Pricing lookup CSV (item codes → prices)
├── CSV Import/            # Drop ticket CSVs here to import
├── Billing Exports/       # Exported billing/column CSVs land here
└── README.md
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

### Install & Run

```bash
cd App
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## Features

### Billing Preview

Aggregates ticket data into billing line items by client. Each ticket's Labor Code, Other Codes, Parts Code, and Shipping Costs are matched against the pricing CSV to calculate unit prices and line totals. Summary cards show original ticket count, unique clients, total value, missing prices, and loaded pricing codes.

### Pricing Data

View and edit the pricing CSV directly in the browser. Add rows, delete rows, drag to reorder, and save changes back to disk. Changes are reflected immediately in billing calculations.

### Raw Data

Browse all imported ticket data with a column picker. Select which fields to include, preview up to 200 rows, and export the selected columns to CSV.

### Sidebar Filters

- **Source files** — toggle which imported CSVs to include
- **Date range** — filter by Date Completed
- **Status** — filter by ticket status
- **Debug panel** — flags missing pricing codes and $0 prices

## Data Flow

1. **Input** — Drop `.csv` ticket exports into the `CSV Import/` folder
2. **Pricing** — Maintain item codes and unit prices in `App/Pricing CSV/`
3. **Processing** — The app parses all CSVs, matches codes to prices, and aggregates billing lines
4. **Output** — Export billing or raw-column CSVs to `Billing Exports/`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/all-data` | Load and merge all CSVs from the import folder |
| POST | `/api/billing-compute` | Compute billing line items from filtered rows |
| POST | `/api/export-billing` | Export billing CSV to the exports folder |
| POST | `/api/export` | Export selected columns to CSV |
| GET | `/api/pricing` | Get pricing map (code → price) |
| GET | `/api/pricing-full` | Get full pricing table with all fields |
| POST | `/api/pricing-save` | Save pricing edits back to CSV |
| GET | `/api/exports` | List recent exports |

## Tech Stack

- **Backend** — Node.js, Express
- **Frontend** — Vanilla HTML/CSS/JS (no framework)
- **Data** — CSV files only (no database)
- **Dependencies** — `express`, `csv-parse`, `csv-stringify`
