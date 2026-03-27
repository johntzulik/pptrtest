# BrowserCompare

## Compare production vs staging sites visually

[![Puppeteer](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)

BrowserCompare captures screenshots of your production and staging sites, generates pixel-level diff images, and produces an interactive HTML report with a dashboard, slider comparison, and filtering.

The report is fully self-contained — just open `report.html` in any browser, no server needed. A ZIP archive is also generated for easy sharing with QA teams.

## Requirements

- **Node** ^24.0.0
- **npm** ^11.0.0
- **System**: macOS, Linux, or WSL (the `zip` command is used for archive generation)

## Installation

```sh
nvm use 24
npm install
```

## Configuration

### 1. Set the template in `.env`

The `TEMPLATE` variable determines which site config file to load from the `sites/` folder:

```sh
TEMPLATE=CLIENT
```

### 2. Available `.env` variables

| Variable | Default | Description |
|---|---|---|
| `TEMPLATE` | — | Name of the site config file (without `.json`) |
| `COMPFILE` | `html_cmp` | Output folder name |
| `IMAGES_FOLDER` | `html_cmp/images` | Where screenshots are stored |
| `TIMEOUT` | `100000` | Navigation timeout in milliseconds (fallback) |
| `DESKTOP_WIDTH` | `1440` | Desktop viewport width (fallback) |
| `DESKTOP_HEIGHT` | `1080` | Desktop viewport height (fallback) |
| `MOBILE_WIDTH` | `360` | Mobile viewport width (fallback) |
| `MOBILE_HEIGHT` | `640` | Mobile viewport height (fallback) |
| `DESKTOP` | `true` | Enable desktop captures (fallback) |
| `MOBILE` | `true` | Enable mobile captures (fallback) |

> Capture settings (TIMEOUT, viewport sizes, DESKTOP/MOBILE) can also be set per-site inside the site's JSON `config` block. Site-level values take priority over `.env`.

### 3. Create a site config file

Create `sites/CLIENT.json` (where `CLIENT` matches your `TEMPLATE` value):

```json
[
  {
    "config": {
      "PRODUCTION_URL": "https://example.org",
      "STAGING_URL": "https://staging.example.org",
      "COOKIE_PRODUCTION": "example.org",
      "COOKIE_STAGING": "staging.example.org",
      "COOKIE_ONE": "",
      "ISCOOKIESET": "false"
    },
    "pages": [
      {
        "id": "001",
        "url": "/"
      },
      {
        "id": "002",
        "url": "/about/"
      }
    ]
  }
]
```

| Config field | Description |
|---|---|
| `PRODUCTION_URL` | Base URL for the production site |
| `STAGING_URL` | Base URL for the staging site |
| `COOKIE_PRODUCTION` | Cookie domain for production |
| `COOKIE_STAGING` | Cookie domain for staging |
| `COOKIE_ONE` | Cookie name (if authentication is needed) |
| `ISCOOKIESET` | Set to `"true"` to enable cookie injection |

Each page needs an `id` (used in filenames) and a `url` (relative path appended to the base URL).

## Usage

### Web GUI (recommended)

```sh
npm start
```

This launches a web server at `http://localhost:3000` and opens the GUI in your default browser. From the GUI you can:

- **Sites** — Create, edit, delete, import, and export site configurations. Per-site capture settings (viewports, timeout, device toggles). Drag & drop page reordering. Bulk URL import.
- **Comparison** — Select a site and run comparisons with real-time progress logs
- **Reports** — Open the latest generated report

### CLI mode

```sh
npm run cli
# or
node index_claude.js
```

### Legacy CLI (Deprecated)

```sh
npm run dev
# or
node index.js
```

### What it does

1. Cleans previous output in `html_cmp/`
2. Launches a headless browser
3. Captures full-page screenshots of each page for production and staging (desktop and/or mobile)
4. Compares each pair using pixelmatch and generates diff images
5. Produces `html_cmp/report.html` — a self-contained report with all CSS/JS/data inlined
6. Creates `html_cmp.zip` for sharing

### Output structure

```
html_cmp/
├── report.html      # Self-contained HTML report (open in any browser)
├── report.css       # Standalone CSS (for server-based usage)
├── report.js        # Standalone JS (for server-based usage)
├── data.json        # Report data (for server-based usage)
└── images/
    ├── 001-prod-desktop-homepage.png
    ├── 001-staging-desktop-homepage.png
    ├── 001-diff-desktop-homepage.png
    └── ...
html_cmp.zip           # ZIP archive of the full folder
```

### Sharing with QA

Send the `html_cmp.zip` file. Recipients just need to:

1. Unzip the archive
2. Open `report.html` in any browser

No server, no dependencies, no command line needed.

## Report features

- **Dashboard** — Summary cards with total, identical, minor (<1%), and changed counts
- **Filters** — Filter by device (desktop/mobile) or status (identical/changed/failed)
- **Sortable columns** — Click any column header to sort
- **Modal viewer** — Click "View" to open a detailed comparison with tabs:
  - **Side by Side** — Both screenshots next to each other (default view)
  - **Difference** — Diff image with changed pixels highlighted in red
  - **Slider** — Drag to compare production and staging side by side
  - **Production** — Full production screenshot
  - **Staging** — Full staging screenshot
- **Navigation arrows** — ← → buttons (and keyboard ArrowLeft/ArrowRight) navigate between comparisons without closing the modal
- **Direct links** — Links to live production and staging pages in the modal tab bar

## Project structure

```
pptrtest/
├── server.js              # Express server (npm start)
├── index_claude.js        # CLI entry point (npm run cli)
├── core/                  # Reusable business logic
│   ├── config.js          # Config read/write, site CRUD
│   ├── capture.js         # Screenshot capture
│   ├── compare.js         # Image comparison (pixelmatch)
│   └── report.js          # Report generation + ZIP
├── routes/                # Express API routes
│   ├── config.js          # GET/PUT /api/config
│   ├── sites.js           # CRUD /api/sites
│   └── jobs.js            # POST /api/jobs, SSE progress
├── ui/                    # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── ui.css
│   └── ui.js
├── sites/                 # Site config JSON files
├── .env                   # Default settings
└── html_cmp/              # Generated output
```

## Tech stack

- Node 24
- npm 11
- express 4
- puppeteer 24
- pixelmatch 7
- pngjs 7

## License

MIT

**Free Software, Hell Yeah!**

## Authors

Github [@johntzulik](https://github.com/johntzulik)

Linkedin [@johntzulik](https://www.linkedin.com/in/johntzulik/)

Twitter [@johntzulik](https://twitter.com/johntzulik)

Tiktok [@johntzulik](https://www.tiktok.com/@johntzulik)

Working on [loymark.com](https://loymark.com/)