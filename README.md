# Budget Tracker

A simple receipt and budget tracker that syncs to your own Google Sheet. Static frontend hosted on GitHub Pages, data lives in your Google Drive.

**Live app:** https://jake30123.github.io/budget-tracker/

## Features

- Log receipts with store, date, total, category, and optional line items
- Dashboard with spending by category and grocery spend over time
- All data syncs to a Google Sheet you own — view and edit it directly in Sheets
- Works on any browser; just plug in the same script URL on each device

## One-time setup (~5 minutes)

1. **Create a Google Sheet.** Go to [sheets.new](https://sheets.new). Give it any name you like.
2. **Open Apps Script.** Inside the sheet: `Extensions → Apps Script`.
3. **Paste the script.** Replace the default `function myFunction() {}` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Click the floppy-disk save icon.
4. **Deploy as a web app.**
   - Click `Deploy → New deployment`.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Set:
     - **Execute as:** Me
     - **Who has access:** Anyone
   - Click **Deploy**. Authorize when prompted (you'll see a "Google hasn't verified this app" warning — click "Advanced → Go to [project name] (unsafe)" to proceed since *you* are the developer).
   - Copy the **Web app URL** that ends in `/exec`.
5. **Connect the app.** Open the live app, paste the URL into the setup screen, click **Connect**.

That's it. From any device, open the app and paste the same URL — it'll connect to the same sheet.

## Updating the script

If you change `Code.gs` later, you need to redeploy: `Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy`.

## Running locally

```sh
python -m http.server 8000
```

Then visit http://localhost:8000.
