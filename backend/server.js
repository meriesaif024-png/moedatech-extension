const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const useSSL = /sslmode=require/.test(connectionString || "") || /proxy\.rlwy\.net/.test(connectionString || "");

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

const API_KEY = process.env.API_KEY;

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      page_title TEXT,
      selector TEXT,
      x_percent REAL,
      y_percent REAL,
      category TEXT NOT NULL DEFAULT 'other',
      text TEXT NOT NULL,
      author TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      screenshot TEXT,
      tab_selectors TEXT,
      completed_by TEXT,
      completed_at TIMESTAMPTZ,
      assigned_to TEXT,
      assigned_at TIMESTAMPTZ,
      reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS screenshot TEXT;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS tab_selectors TEXT;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed_by TEXT;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS assigned_to TEXT;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS reference TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.path === "/health") return next();
  if (req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/notes", async (req, res) => {
  const { url } = req.query;
  const result = url
    ? await pool.query("SELECT * FROM notes WHERE url = $1 ORDER BY created_at DESC", [url])
    : await pool.query("SELECT * FROM notes ORDER BY created_at DESC LIMIT 500");
  res.json(result.rows);
});

app.post("/api/notes", async (req, res) => {
  const {
    url,
    pageTitle,
    selector,
    xPercent,
    yPercent,
    category,
    text,
    author,
    screenshot,
    tabSelectors,
    assignedTo,
    reference,
  } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const result = await pool.query(
    `INSERT INTO notes (url, page_title, selector, x_percent, y_percent, category, text, author, screenshot, tab_selectors, assigned_to, assigned_at, reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      url,
      pageTitle || null,
      selector || null,
      xPercent ?? null,
      yPercent ?? null,
      category || "other",
      text || "",
      author || "Anonymous",
      screenshot || null,
      tabSelectors ? JSON.stringify(tabSelectors) : null,
      assignedTo || null,
      assignedTo ? new Date() : null,
      reference || null,
    ]
  );
  res.status(201).json(result.rows[0]);
});

app.patch("/api/notes/:id", async (req, res) => {
  const { status, completedBy, assignedTo, reference } = req.body;

  if (reference !== undefined) {
    const result = await pool.query("UPDATE notes SET reference = $1 WHERE id = $2 RETURNING *", [
      reference || null,
      req.params.id,
    ]);
    if (!result.rows[0]) return res.status(404).json({ error: "not found" });
    return res.json(result.rows[0]);
  }

  if (assignedTo !== undefined) {
    const result = assignedTo
      ? await pool.query("UPDATE notes SET assigned_to = $1, assigned_at = now() WHERE id = $2 RETURNING *", [
          assignedTo,
          req.params.id,
        ])
      : await pool.query("UPDATE notes SET assigned_to = NULL, assigned_at = NULL WHERE id = $1 RETURNING *", [
          req.params.id,
        ]);
    if (!result.rows[0]) return res.status(404).json({ error: "not found" });
    return res.json(result.rows[0]);
  }

  if (!["open", "done"].includes(status)) return res.status(400).json({ error: "invalid status" });

  const result =
    status === "done"
      ? await pool.query(
          "UPDATE notes SET status = $1, completed_by = $2, completed_at = now() WHERE id = $3 RETURNING *",
          [status, completedBy || "Anonymous", req.params.id]
        )
      : await pool.query(
          "UPDATE notes SET status = $1, completed_by = NULL, completed_at = NULL WHERE id = $2 RETURNING *",
          [status, req.params.id]
        );
  if (!result.rows[0]) return res.status(404).json({ error: "not found" });
  res.json(result.rows[0]);
});

app.delete("/api/notes/:id", async (req, res) => {
  await pool.query("DELETE FROM notes WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

app.get("/api/team-members", async (req, res) => {
  const result = await pool.query("SELECT * FROM team_members ORDER BY name");
  res.json(result.rows);
});

app.post("/api/team-members", async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = await pool.query(
    "INSERT INTO team_members (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING *",
    [name]
  );
  res.status(201).json(result.rows[0]);
});

app.delete("/api/team-members/:id", async (req, res) => {
  await pool.query("DELETE FROM team_members WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

const port = process.env.PORT || 3000;
init()
  .then(() => {
    app.listen(port, () => console.log(`feedback-api listening on ${port}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
