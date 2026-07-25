// Persistence layer. Turns the live alert/all-clear stream into durable incident
// records so the supervisor dashboard has real history that survives restarts.
//
// Degrades gracefully: with no DATABASE_URL the whole module is a no-op and the
// relay runs exactly as before (in-memory only). That keeps local/LAN use
// zero-config while a hosted deployment (Render Postgres) gets full persistence.
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

// Managed Postgres (Render/Railway/…) terminates TLS with certs we don't pin,
// so relax verification there; local Postgres usually speaks plaintext.
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    })
  : null;

const enabled = () => pool !== null;

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Create the schema on boot. Idempotent, so it's safe to run on every deploy.
async function init() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      severity     TEXT NOT NULL,
      message      TEXT,
      sender       TEXT,
      zone         TEXT,
      lat          DOUBLE PRECISION,
      lng          DOUBLE PRECISION,
      raised_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at  TIMESTAMPTZ,
      resolved_by  TEXT,
      status       TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS incidents_raised_at_idx ON incidents (raised_at DESC);
    CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
  `);
  return true;
}

// Record a raised alert. `worker` is the triggering device's roster entry (if
// known), which is where the alert's location comes from — the wire alert itself
// carries no coordinates.
async function recordAlert(alert, worker) {
  if (!pool) return;
  const ts = numOrNull(alert.timestamp) ?? Date.now();
  await pool.query(
    `INSERT INTO incidents (id, type, severity, message, sender, zone, lat, lng, raised_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      String(alert.id),
      String(alert.type),
      String(alert.severity),
      alert.message || null,
      alert.sender || null,
      worker?.zone || null,
      numOrNull(worker?.lat),
      numOrNull(worker?.lng),
      ts,
    ]
  );
}

// Resolve the currently-active incident(s). The app runs one alarm at a time and
// all-clears aren't tied to a specific alert id, so clear whatever is still open.
async function resolveActive(allClear) {
  if (!pool) return;
  const ts = numOrNull(allClear.timestamp) ?? Date.now();
  await pool.query(
    `UPDATE incidents
        SET status = 'resolved', resolved_at = to_timestamp($1 / 1000.0), resolved_by = $2
      WHERE status = 'active'`,
    [ts, allClear.sender || null]
  );
}

async function listIncidents({ limit = 50, status } = {}) {
  if (!pool) return [];
  const capped = Math.max(1, Math.min(Number(limit) || 50, 500));
  const params = [];
  let where = '';
  if (status === 'active' || status === 'resolved') {
    params.push(status);
    where = `WHERE status = $1`;
  }
  params.push(capped);
  const { rows } = await pool.query(
    `SELECT * FROM incidents ${where} ORDER BY raised_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function getIncident(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM incidents WHERE id = $1`, [String(id)]);
  return rows[0] || null;
}

async function stats() {
  if (!pool) return null;
  const { rows } = await pool.query(`
    SELECT
      count(*)::int                                              AS total,
      count(*) FILTER (WHERE status = 'active')::int             AS active,
      count(*) FILTER (WHERE raised_at > now() - interval '24 hours')::int AS last_24h,
      avg(EXTRACT(EPOCH FROM (resolved_at - raised_at)))
        FILTER (WHERE resolved_at IS NOT NULL)                   AS avg_resolve_seconds
    FROM incidents
  `);
  const r = rows[0];
  return {
    total: r.total,
    active: r.active,
    last24h: r.last_24h,
    avgResolveSeconds: r.avg_resolve_seconds === null ? null : Math.round(Number(r.avg_resolve_seconds)),
  };
}

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  enabled,
  init,
  recordAlert,
  resolveActive,
  listIncidents,
  getIncident,
  stats,
  close,
};
