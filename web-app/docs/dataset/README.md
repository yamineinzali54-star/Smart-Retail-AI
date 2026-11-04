# Sample datasets

This directory contains example retail master data, workflow worksheets,
reference AI model configurations, and sales-analysis CSVs. These files are
sample data, not a production database seed. Review names, prices, dates, tax
settings, and provider availability before using them.

## Files

| File | Rows | Purpose |
| --- | ---: | --- |
| `units.csv` | 13 | Example units of measure |
| `categories.csv` | 6 | Example product categories and tax settings |
| `products.csv` | 28 | Example products linked by category and unit name |
| `suppliers.csv` | 6 | Example supplier contacts |
| `branches.csv` | 1 | Illustrative branch row; no branch CSV importer is provided |
| `purchase_order_lines.csv` | 84 | Worksheet for manually creating purchase orders |
| `grn_lines.csv` | 84 | Worksheet for manually receiving approved purchase orders |
| `ai_model.csv` | 17 | Reference OpenRouter/OpenCode Zen model settings; not an importer file |
| `supermarket_sales.csv` | 1,000 | Sales analysis sample |
| `refactor_supermarket_sales.csv` | 1,000 | Refactored sales analysis sample |

The two sales-analysis files use a separate transaction-analysis schema. They
are not accepted by the application bulk-import routes.

## Importable master data

The application currently supports preview-then-commit CSV imports for
categories, products, and suppliers. Open the matching page (`/categories`,
`/products`, or `/suppliers`) and download its template to see the current
column names. Units are managed manually at `/units`; there is no units CSV
import. The `branches.csv`, `purchase_order_lines.csv`, and `grn_lines.csv`
files also have no importer.

Import master data in this order:

1. Add the required units at `/units`.
2. Import categories at `/categories`.
3. Import products at `/products`; each category and unit name must already
   exist in the current branch.
4. Import suppliers at `/suppliers`.

Purchase orders are created at `/purchase-orders/new`. An admin must approve
the draft before it can be received. Create a GRN against an approved PO and
enter the received quantities, expiry dates, and prices from
`grn_lines.csv` as applicable. The worksheet is not uploaded directly.

## CSV format notes

- Import preview does not write data. Review valid and rejected rows before
  committing.
- CSV import accepts up to 1,000 rows and 500 KB per file.
- The current parser splits cells on commas; avoid commas and quoted
  multi-line values in fields. Use the downloaded template headers.
- Duplicate names within one import are rejected. Product imports resolve
  `category_name` and `unit_name` within the signed-in branch.
- Category tax rates allow up to two decimal places. Product reorder
  thresholds must be non-negative integers.

## AI model reference file

`ai_model.csv` is a non-importable example for the model settings at
`/ai-models`. Its official provider limit fields are blank deliberately:
fetch the current catalog from the provider rather than assigning local
limits. Configure provider keys and models in the admin page, then refresh
the catalog to save the provider's current model metadata. Model IDs, free
status, limits, and provider policies can change.

Never place real API keys in a CSV file. The admin settings page stores keys
encrypted with `AUTH_SECRET`; keys should not be committed to Git or sent to
the browser.
