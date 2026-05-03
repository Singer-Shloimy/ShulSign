# 🕍 Shul Display Board

A beautiful, full-featured shul display board with live zmanim, PDF rotation, and an admin panel.

## Requirements

- **Node.js 18+** — download from https://nodejs.org

## Setup (first time)

1. Unzip this folder
2. Open a terminal in the `shul-board` folder
3. Run:

```bash
npm install
```

## Start the server

```bash
npm start
```

Then open your browser:

| Page    | URL                          |
|---------|------------------------------|
| Display | http://localhost:3000/display |
| Admin   | http://localhost:3000/admin   |

## Full-screen display

1. Open `http://localhost:3000/display` in Chrome/Edge
2. Press **F11** for full-screen (or use the browser menu)
3. The board auto-refreshes settings every 20 seconds — no reload needed after admin changes

## Admin Panel

Go to `http://localhost:3000/admin` to:

- **Upload PDFs** — drag & drop or click to upload. PDFs rotate automatically on the display
- **Settings** — shul name, city, location (lat/lon for zmanim), ticker text, simchas, announcements
- **Manage PDFs** — set display order, duration (seconds each PDF shows), toggle active/inactive, delete

## Zmanim

Enter your latitude/longitude in Settings → Location. Find coordinates at https://www.latlong.net

Example cities:
- New York: 40.7128, -74.0060
- Los Angeles: 34.0522, -118.2437
- Chicago: 41.8781, -87.6298
- Jerusalem: 31.7683, 35.2137

## Customization

All data is stored in `data/display.db` (SQLite). Uploaded PDFs are in `public/pdfs/`.

## Troubleshooting

- **Port in use?** Run `PORT=3001 npm start` to use a different port
- **Zmanim not loading?** Check your lat/lon in Settings and ensure the server has internet access
- **PDFs not showing?** Make sure the PDF is marked "Active" in the Admin → PDFs page
