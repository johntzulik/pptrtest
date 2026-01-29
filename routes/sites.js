/**
 * routes/sites.js - Site configuration CRUD API
 */

const express = require("express");
const {
  listSites,
  readSite,
  writeSite,
  deleteSite,
  validateSiteConfig,
} = require("../core/config");

const router = express.Router();

// GET /api/sites — list all site config names
router.get("/", (req, res) => {
  try {
    res.json(listSites());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sites/:name — get one site config
router.get("/:name", (req, res) => {
  try {
    const data = readSite(req.params.name);
    res.json(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      return res.status(404).json({ error: "Site not found" });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites — create new site config { name, data }
router.post("/", (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: "Missing 'name' and/or 'data'" });
    }
    const validation = validateSiteConfig(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    writeSite(name, data);
    res.status(201).json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sites/:name — update existing site config
router.put("/:name", (req, res) => {
  try {
    const data = req.body;
    const validation = validateSiteConfig(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    writeSite(req.params.name, data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:name — delete a site config
router.delete("/:name", (req, res) => {
  try {
    const deleted = deleteSite(req.params.name);
    if (!deleted) {
      return res.status(404).json({ error: "Site not found" });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/import — import a JSON config (body IS the JSON)
router.post("/import", (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: "Missing 'name' and/or 'data'" });
    }
    const validation = validateSiteConfig(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    writeSite(name, data);
    res.status(201).json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
