# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] - 2026-03-25

### Changed

- **Playwright migration** — Screenshot capture (`core/capture.js`) rewritten with Playwright (`chromium`). Replaced `puppeteer.launch()` with `chromium.launch()`, `browser.newPage()` with `browser.newContext() + context.newPage()`, `page.setCookie()` with `context.addCookies([])`, and `waitUntil: "networkidle2"` with `waitUntil: "networkidle"`. Viewport is now set at context level.
- **Audit module removed** — Audit and Deep Dive features extracted into the independent [BrowserAudit](../BrowserAudit) project. Tab "Audit" removed from the UI.
- **server.js** — Removed `/api/audit` and `/api/deepdive` route mounts.

### Removed

- `puppeteer` dependency (replaced by `playwright`)
- Tab "Audit" and all related UI/API code (moved to BrowserAudit project)

## [2.1.0] - 2026-03-25

### Added

- **Per-site Capture Settings** — Viewport sizes (desktop/mobile), timeout, and device toggles (DESKTOP/MOBILE) can now be set individually in each site's JSON config. `.env` values are used as fallback for backward compatibility.
- **Header checkboxes** — Checkbox in the Screenshot and Audit column headers to select/deselect all rows at once in the pages table.
- **Drag & drop row reordering** — Pages can be reordered by dragging rows in the site editor.
- **Bulk URL import** — Paste a list of URLs (one per line) and they are auto-added as pages with sequential IDs, skipping duplicates.
- **Top header action buttons** — Save, Export JSON, and Import JSON buttons added to the site editor header, so they are always visible regardless of how many pages are listed.
- **Comparison modal navigation** — Previous (←) and Next (→) arrow buttons in the modal header to navigate between screenshot comparisons without closing and reopening. Arrow keys (ArrowLeft / ArrowRight) also supported.
- **Modal defaults to Side by Side** — The comparison popup now opens on the "Side by Side" tab instead of "Difference".

### Changed

- **Tab order** — "Sites" is now the first tab; "Comparison" (renamed from "Dashboard") is second.
- **Settings tab removed** — Per-site settings replace the global Settings tab entirely.
- **Fix ID auto-increment** — Adding a new page now correctly uses `max(existing IDs) + 1` instead of `pages.length + 1`, so IDs stay correct after rows are deleted.
- **Modal tab order** — "Side by Side" appears first; "Difference" second.

## [2.0.0] - 2026-01-29

### Added

- **Web GUI** — Full graphical interface served via Express at `http://localhost:3000`. Launch with `npm start`.
- **Dashboard tab** — Select a site template and run comparisons with one click. Real-time log output via Server-Sent Events. Summary cards displayed on completion.
- **Sites tab** — CRUD interface for site configurations. Create, edit, and delete site profiles. Add/remove pages dynamically. Import and export JSON configs.
- **Settings tab** — Edit `.env` settings (viewports, timeout, device toggles, active template) from the browser.
- **Reports tab** — Open the latest generated report directly from the GUI.
- **Modular architecture** — Core logic split into reusable modules under `core/`:
  - `core/config.js` — Config read/write, site CRUD, validation
  - `core/capture.js` — Screenshot capture with progress callbacks
  - `core/compare.js` — Image comparison with progress callbacks
  - `core/report.js` — Report generation and ZIP creation
- **REST API** — Full API for programmatic access:
  - `GET/PUT /api/config` — Read/write `.env` settings
  - `GET/POST/PUT/DELETE /api/sites` — Site config CRUD
  - `POST /api/jobs` — Start comparison runs
  - `GET /api/jobs/:id/stream` — SSE progress stream
- **`npm start` script** — Launches the web GUI with auto-open in the default browser.
- **`npm run cli` script** — Alias for CLI mode (`node index_claude.js`).

### Changed

- **Refactored `index_claude.js`** — Now imports from `core/` modules instead of containing all logic inline. CLI behavior is unchanged.
- **Version bumped to 2.0.0** — Major version bump for the GUI addition and modular architecture.

### Removed

- **Legacy dependencies** — Removed `canvas`, `resemblejs`, `compress-images`, `gm`, `mz`, `glob`, `pngquant-bin`, `fs` shim. The brew packages (`cairo`, `pango`, `libpng`, etc.) are no longer needed.

## [1.2.0] - 2025-01-28

### Added

- **New `index_claude.js` entry point** — Improved and fully documented version of the visual regression tool.
- **Slider comparison view** — Drag-to-compare overlay in the modal to visually slide between production and staging screenshots.
- **Self-contained HTML report** — CSS, JS, and data are inlined into `report.html` so it works when opened directly from the filesystem (`file://`), no server required.
- **ZIP output** — Automatically generates a `.zip` archive of the output folder, ready to share with QA teams who only need to unzip and open `report.html`.
- **Dashboard with statistics** — Color-coded summary cards showing identical, minor (<1%), changed, and failed comparison counts.
- **Filtering and sorting** — Filter results by device (desktop/mobile) or status (identical/changed/failed). Click column headers to sort.
- **Side-by-side view** — Modal tab to view production and staging screenshots next to each other.
- **Production/Staging links in modal** — Direct links to the live pages, positioned in the modal tab bar.
- **Touch support for slider** — Mobile-friendly drag events on the slider comparison.
- **`npm run claude` script** — Shortcut to run `index_claude.js`.

### Changed

- **Single browser instance** — Reuses one Puppeteer browser across all captures instead of launching a new one per page.
- **Parallel capture** — Production and staging screenshots for each device are captured concurrently.
- **Replaced resemblejs with pixelmatch + pngjs** — Lighter, more reliable pixel comparison with no native canvas dependency for diffing.
- **Image size normalization** — When production and staging screenshots differ in dimensions, both are padded to the larger size to prevent false positives.
- **Images stored as files** — Screenshots are referenced by relative path instead of base64-encoded inline, improving report load performance.
- **Updated dependencies** — puppeteer ^24.0.0, added pixelmatch ^7.1.0 and pngjs ^7.0.0.
- **Node requirement** — Updated to Node ^24.0.0 and npm ^11.0.0.
- **All comments and logs in English** — Code documentation, console output, and report UI are fully in English.

### Removed

- **jQuery dependency** — The report uses vanilla JavaScript only.
- **iframe-based comparison** — Replaced with image-based modal views.
- **File server requirement** — The report no longer needs to be served over HTTP.

## [1.1.0] - Previous

### Added

- Multilingual support (`multilingual.js`)
- Multiple site configurations
- Cookie support for authenticated staging environments

## [1.0.0] - Initial Release

### Added

- Screenshot capture for production and staging using Puppeteer
- Visual comparison using resemblejs
- HTML report with template-based output
- Desktop and mobile viewport support
- Configurable via `.env` and `sites/*.json`
