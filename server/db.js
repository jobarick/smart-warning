// Persistence layer. Turns the live alert/all-clear stream into durable incident
// records, and backs multi-tenant orgs + supervisor accounts.
//
// Degrades gracefully: with no DATABASE_URL the whole module is a no-op and the
// relay runs exactly as before (in-memory, single global room). Orgs and
// accounts only exist when a database is configured.
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

// Create/upgrade the schema on boot. Idempotent — safe on every deploy, and
// migrates an existing incidents table (from before orgs) by adding org_id.
async function init() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      join_code  TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'supervisor',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_org_idx ON push_subscriptions (org_id);

    -- Small key/value store for server-managed config (e.g. the VAPID keypair).
    CREATE TABLE IF NOT EXISTS app_kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id           TEXT PRIMARY KEY,
      org_id       UUID,
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
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS org_id UUID;
    CREATE INDEX IF NOT EXISTS incidents_raised_at_idx ON incidents (raised_at DESC);
    CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
    CREATE INDEX IF NOT EXISTS incidents_org_idx ON incidents (org_id);
  `);
  return true;
}

// --- Organizations & users -------------------------------------------------

// Human-friendly join code: 6 chars, uppercase, no ambiguous 0/O/1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

async function createOrg(name) {
  if (!pool) throw new Error('persistence disabled');
  // Retry on the (very unlikely) join_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO organizations (name, join_code) VALUES ($1, $2) RETURNING *`,
        [name, code],
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // unique_violation → new code
      throw e;
    }
  }
  throw new Error('could not allocate a unique join code');
}

async function getOrgByCode(code) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM organizations WHERE join_code = $1`,
    [String(code || '').toUpperCase()],
  );
  return rows[0] || null;
}

async function getOrgById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM organizations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createUser({ orgId, email, passwordHash, name, role = 'supervisor' }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO users (org_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, email.toLowerCase(), passwordHash, name, role],
  );
  return rows[0];
}

async function getUserByEmail(email) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [String(email || '').toLowerCase()]);
  return rows[0] || null;
}

async function getUserById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

// --- Incidents (all scoped to an org) --------------------------------------

// Record a raised alert. `worker` is the triggering device's roster entry (if
// known), the source of the alert's location — the wire alert carries none.
async function recordAlert(alert, worker, orgId) {
  if (!pool) return;
  const ts = numOrNull(alert.timestamp) ?? Date.now();
  await pool.query(
    `INSERT INTO incidents (id, org_id, type, severity, message, sender, zone, lat, lng, raised_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0), 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      String(alert.id),
      orgId || null,
      String(alert.type),
      String(alert.severity),
      alert.message || null,
      alert.sender || null,
      worker?.zone || null,
      numOrNull(worker?.lat),
      numOrNull(worker?.lng),
      ts,
    ],
  );
}

// Resolve the active incident(s) for one org only.
async function resolveActive(allClear, orgId) {
  if (!pool) return;
  const ts = numOrNull(allClear.timestamp) ?? Date.now();
  await pool.query(
    `UPDATE incidents
        SET status = 'resolved', resolved_at = to_timestamp($1 / 1000.0), resolved_by = $2
      WHERE status = 'active' AND org_id IS NOT DISTINCT FROM $3`,
    [ts, allClear.sender || null, orgId || null],
  );
}

async function listIncidents({ limit = 50, status, orgId } = {}) {
  if (!pool) return [];
  const capped = Math.max(1, Math.min(Number(limit) || 50, 500));
  const params = [orgId || null];
  let where = `WHERE org_id IS NOT DISTINCT FROM $1`;
  if (status === 'active' || status === 'resolved') {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  params.push(capped);
  const { rows } = await pool.query(
    `SELECT * FROM incidents ${where} ORDER BY raised_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function getIncident(id, orgId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM incidents WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2`,
    [String(id), orgId || null],
  );
  return rows[0] || null;
}

async function stats(orgId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `
    SELECT
      count(*)::int                                              AS total,
      count(*) FILTER (WHERE status = 'active')::int             AS active,
      count(*) FILTER (WHERE raised_at > now() - interval '24 hours')::int AS last_24h,
      avg(EXTRACT(EPOCH FROM (resolved_at - raised_at)))
        FILTER (WHERE resolved_at IS NOT NULL)                   AS avg_resolve_seconds
    FROM incidents
    WHERE org_id IS NOT DISTINCT FROM $1
  `,
    [orgId || null],
  );
  const r = rows[0];
  return {
    total: r.total,
    active: r.active,
    last24h: r.last_24h,
    avgResolveSeconds: r.avg_resolve_seconds === null ? null : Math.round(Number(r.avg_resolve_seconds)),
  };
}

// --- Push subscriptions (org-scoped) ---------------------------------------

async function createPushSubscription({ orgId, endpoint, p256dh, auth }) {
  if (!pool) return;
  // A device may re-subscribe (new keys) — key on the endpoint.
  await pool.query(
    `INSERT INTO push_subscriptions (org_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET org_id = EXCLUDED.org_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [orgId, endpoint, p256dh, auth],
  );
}

async function listPushSubscriptions(orgId) {
  if (!pool) return [];
  const { rows } = await pool.query(`SELECT * FROM push_subscriptions WHERE org_id = $1`, [orgId]);
  return rows;
}

async function deletePushSubscription(endpoint) {
  if (!pool) return;
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

// --- Key/value config ------------------------------------------------------

async function getKv(key) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT value FROM app_kv WHERE key = $1`, [key]);
  return rows[0] ? rows[0].value : null;
}

async function setKv(key, value) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO app_kv (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

async function close() {
  if (pool) await pool.end();
}

module.exports = {
  enabled,
  init,
  createOrg,
  getOrgByCode,
  getOrgById,
  createUser,
  getUserByEmail,
  getUserById,
  recordAlert,
  resolveActive,
  listIncidents,
  getIncident,
  stats,
  createPushSubscription,
  listPushSubscriptions,
  deletePushSubscription,
  getKv,
  setKv,
  close,
};
