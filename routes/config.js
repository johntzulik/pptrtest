/**
 * routes/config.js - .env configuration API
 */

const express = require("express");
const { readEnvConfig, writeEnvConfig } = require("../core/config");

const router = express.Router();

// GET /api/config — returns all .env key-value pairs
router.get("/", (req, res) => {
  try {
    const config = readEnvConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config — updates .env key-value pairs
router.put("/", (req, res) => {
  try {
    const current = readEnvConfig();
    const updated = { ...current, ...req.body };
    writeEnvConfig(updated);
    res.json({ ok: true, config: readEnvConfig() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
