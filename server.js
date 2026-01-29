/**
 * server.js - BrowserCompare Web GUI Server
 *
 * Starts an Express server that serves the configuration UI
 * and provides API routes for managing sites, settings, and
 * running visual regression comparisons.
 *
 * Usage:
 *   npm start
 *   # or
 *   node server.js
 */

const path = require("path");
const express = require("express");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "10mb" }));

// Serve frontend UI
app.use(express.static(path.join(__dirname, "ui")));

// Serve generated report files (images, report.html, etc.)
app.use("/output", express.static(path.join(__dirname, process.env.COMPFILE || "html_cmp")));

// API routes
app.use("/api/config", require("./routes/config"));
app.use("/api/sites", require("./routes/sites"));
app.use("/api/jobs", require("./routes/jobs"));

// Start server
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  BrowserCompare GUI running at ${url}\n`);

  // Auto-open browser
  const { exec } = require("child_process");
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`);
});
