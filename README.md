# Budget Tracker

A simple, client-side receipt and budget tracker. All data is stored in your browser's `localStorage` — no backend, no accounts, no sync.

## Features

- Log receipts with store, date, total, category, and optional line items
- Dashboard with spending by category (doughnut chart) and grocery spend over time (bar + cumulative line)
- Edit categories on receipts and individual items
- Export / import your data as JSON for backup or moving between browsers

## Running locally

It's a static site — just open `index.html` in a browser, or serve the folder:

```sh
python -m http.server 8000
```

Then visit http://localhost:8000.

## Deployment

This repo is configured for GitHub Pages. Pushing to `main` publishes the site at `https://<user>.github.io/budget-tracker/`.

## Data storage

Receipts and items live under the `budget-tracker-data-v1` key in `localStorage`. Use the **Data** tab to export a JSON backup or import one.
