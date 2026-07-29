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

    -- Unauthenticated reports from the public page. These are NOT alerts: they
    -- sit here until a supervisor escalates one, which is what makes a public
    -- reporting URL safe to put on a wall.
    CREATE TABLE IF NOT EXISTS reports (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      message     TEXT NOT NULL,
      location    TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      handled_at  TIMESTAMPTZ,
      handled_by  TEXT,
      incident_id TEXT
    );
    CREATE INDEX IF NOT EXISTS reports_org_status_idx ON reports (org_id, status);
    CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);

    -- Separate from join_code on purpose: the join code admits a device to the
    -- relay room and lets it raise real alarms, so a code printed on a public
    -- poster must not be that one.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS organizations_public_code_idx ON organizations (public_code);

    -- Organization profile. Registration used to capture only a name; a real
    -- account needs an owner of record and a way to reach them.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS admin_name    TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone         TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry      TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address       TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country       TEXT;
    ALTER TABLE users         ADD COLUMN IF NOT EXISTS phone         TEXT;

    -- Safe destinations. A row with assigned_to IS NULL applies to the whole
    -- organization; a row naming an operator overrides it for that person.
    -- 'kind' is the alert category the destination serves, so an alert can be
    -- routed to the right place instead of always to one static assembly point.
    CREATE TABLE IF NOT EXISTS destinations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'assembly',
      label       TEXT NOT NULL,
      lat         DOUBLE PRECISION NOT NULL,
      lng         DOUBLE PRECISION NOT NULL,
      address     TEXT,
      phone       TEXT,
      assigned_to TEXT,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS destinations_org_idx ON destinations (org_id, kind);

    -- Movement history while an alert is live. Written only between the alert
    -- and its all-clear, so this never becomes routine location surveillance.
    CREATE TABLE IF NOT EXISTS location_pings (
      id          BIGSERIAL PRIMARY KEY,
      org_id      UUID,
      incident_id TEXT,
      worker_id   TEXT NOT NULL,
      worker_name TEXT,
      lat         DOUBLE PRECISION NOT NULL,
      lng         DOUBLE PRECISION NOT NULL,
      accuracy    DOUBLE PRECISION,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS location_pings_incident_idx ON location_pings (incident_id, at);
    CREATE INDEX IF NOT EXISTS location_pings_org_at_idx   ON location_pings (org_id, at DESC);

    -- Supervisor feedback. Stored first and delivered second, so a submission is
    -- never lost because mail was misconfigured.
    CREATE TABLE IF NOT EXISTS feedback (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       UUID,
      user_id      UUID,
      author_name  TEXT,
      author_email TEXT,
      kind         TEXT NOT NULL DEFAULT 'suggestion',
      subject      TEXT NOT NULL,
      message      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new',
      delivered    BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS feedback_org_idx     ON feedback (org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
  `);
  await backfillPublicCodes();
  return true;
}

// Give any organization created before public reporting existed a code, so the
// feature works on an already-deployed database without a manual migration.
async function backfillPublicCodes() {
  if (!pool) return;
  const { rows } = await pool.query(`SELECT id FROM organizations WHERE public_code IS NULL`);
  for (const row of rows) {
    let assigned = false;
    for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
      try {
        await pool.query(`UPDATE organizations SET public_code = $1 WHERE id = $2`, [randomCode(8), row.id]);
        assigned = true;
      } catch (e) {
        if (e.code !== '23505') throw e; // anything but a collision is real
      }
    }
    // Leaving it null is not fatal — that org simply has no public reporting
    // link — but it must not happen silently.
    if (!assigned) console.error(`[db] could not allocate a public_code for org ${row.id}`);
  }
}

// --- Organizations & users -------------------------------------------------

// Human-friendly join code: 6 chars, uppercase, no ambiguous 0/O/1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

async function createOrg(name, profile = {}) {
  if (!pool) throw new Error('persistence disabled');
  // Retry on the (very unlikely) join_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO organizations
           (name, join_code, public_code, admin_name, contact_email, phone, industry, address, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          name,
          code,
          randomCode(8),
          profile.adminName || null,
          profile.contactEmail || null,
          profile.phone || null,
          profile.industry || null,
          profile.address || null,
          profile.country || null,
        ],
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // unique_violation → new code
      throw e;
    }
  }
  throw new Error('could not allocate a unique join code');
}

// Update the editable parts of an org profile. Never touches join_code /
// public_code — rotating those would silently lock out every joined device.
async function updateOrgProfile(id, profile = {}) {
  if (!pool) return null;
  const fields = { name: profile.name, admin_name: profile.adminName, contact_email: profile.contactEmail,
    phone: profile.phone, industry: profile.industry, address: profile.address, country: profile.country };
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    params.push(val === '' ? null : val);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return getOrgById(id);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE organizations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function getOrgByCode(code) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM organizations WHERE join_code = $1`,
    [String(code || '').toUpperCase()],
  );
  return rows[0] || null;
}

async function getOrgByPublicCode(code) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT * FROM organizations WHERE public_code = $1`,
    [String(code || '').toUpperCase()],
  );
  return rows[0] || null;
}

// --- Public reports --------------------------------------------------------

async function createReport({ orgId, message, location }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO reports (org_id, message, location) VALUES ($1, $2, $3) RETURNING *`,
    [orgId, message, location || null],
  );
  return rows[0];
}

async function listReports({ orgId, status = 'pending', limit = 50 } = {}) {
  if (!pool) return [];
  const params = [orgId];
  let sql = `SELECT * FROM reports WHERE org_id = $1`;
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  params.push(Math.min(Math.max(1, limit), 200));
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function countPendingReports(orgId) {
  if (!pool) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM reports WHERE org_id = $1 AND status = 'pending'`,
    [orgId],
  );
  return rows[0]?.n || 0;
}

// Move a report out of the queue. Scoped by org so one site's supervisor can
// never act on another's report, even with a guessed id.
async function handleReport({ id, orgId, status, handledBy, incidentId = null }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE reports SET status = $1, handled_at = now(), handled_by = $2, incident_id = $3
      WHERE id = $4 AND org_id = $5 AND status = 'pending'
      RETURNING *`,
    [status, handledBy || null, incidentId, id, orgId],
  );
  return rows[0] || null;
}

async function getOrgById(id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM organizations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createUser({ orgId, email, passwordHash, name, role = 'supervisor', phone = null }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO users (org_id, email, password_hash, name, role, phone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [orgId, email.toLowerCase(), passwordHash, name, role, phone],
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

// --- Safe destinations -----------------------------------------------------

// Destinations visible to one operator: the org-wide rows plus any assigned
// specifically to them. Personal rows sort first so a caller taking the first
// match of a kind gets the assigned override rather than the org default.
async function listDestinations({ orgId, operatorId = null, kind = null } = {}) {
  if (!pool) return [];
  const params = [orgId];
  let sql = `SELECT * FROM destinations WHERE org_id = $1`;
  if (operatorId) {
    params.push(operatorId);
    sql += ` AND (assigned_to IS NULL OR assigned_to = $${params.length})`;
  } else {
    sql += ` AND assigned_to IS NULL`;
  }
  if (kind) { params.push(kind); sql += ` AND kind = $${params.length}`; }
  sql += ` ORDER BY (assigned_to IS NULL), kind, created_at`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

// Every destination in the org, including per-operator ones — the supervisor's
// management view, as opposed to what a single device should follow.
async function listAllDestinations(orgId, limit = 500) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM destinations WHERE org_id = $1 ORDER BY kind, assigned_to NULLS FIRST, created_at LIMIT $2`,
    [orgId, Math.min(Math.max(1, limit), 1000)],
  );
  return rows;
}

async function createDestination({ orgId, kind = 'assembly', label, lat, lng, address = null, phone = null, assignedTo = null, createdBy = null }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO destinations (org_id, kind, label, lat, lng, address, phone, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [orgId, kind, label, lat, lng, address, phone, assignedTo, createdBy],
  );
  return rows[0];
}

// Scoped by org so a guessed id can never delete another site's destination.
async function deleteDestination(id, orgId) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `DELETE FROM destinations WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, orgId],
  );
  return rows[0] || null;
}

// --- Live location tracking ------------------------------------------------

// One position sample for a worker during a live incident. Cheap and additive:
// the roster already carries these coordinates, this just makes them durable so
// movement can be replayed afterwards.
async function recordPing({ orgId, incidentId, workerId, workerName, lat, lng, accuracy }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO location_pings (org_id, incident_id, worker_id, worker_name, lat, lng, accuracy)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId || null, incidentId || null, String(workerId), workerName || null, lat, lng, numOrNull(accuracy)],
  );
}

async function listPings({ incidentId, orgId, workerId = null, limit = 1000 } = {}) {
  if (!pool) return [];
  const params = [];
  const where = [];
  if (incidentId) { params.push(incidentId); where.push(`incident_id = $${params.length}`); }
  if (orgId) { params.push(orgId); where.push(`org_id = $${params.length}`); }
  if (workerId) { params.push(workerId); where.push(`worker_id = $${params.length}`); }
  if (!where.length) return [];
  params.push(Math.min(Math.max(1, limit), 5000));
  const { rows } = await pool.query(
    `SELECT * FROM location_pings WHERE ${where.join(' AND ')} ORDER BY at ASC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

// --- Feedback --------------------------------------------------------------

async function createFeedback({ orgId, userId, authorName, authorEmail, kind = 'suggestion', subject, message }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO feedback (org_id, user_id, author_name, author_email, kind, subject, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orgId || null, userId || null, authorName || null, authorEmail || null, kind, subject, message],
  );
  return rows[0];
}

async function listFeedback({ orgId, limit = 50 } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM feedback WHERE org_id IS NOT DISTINCT FROM $1 ORDER BY created_at DESC LIMIT $2`,
    [orgId || null, Math.min(Math.max(1, limit), 200)],
  );
  return rows;
}

async function markFeedbackDelivered(id) {
  if (!pool) return;
  await pool.query(`UPDATE feedback SET delivered = true WHERE id = $1`, [id]);
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
  updateOrgProfile,
  getOrgByCode,
  getOrgByPublicCode,
  getOrgById,
  listDestinations,
  listAllDestinations,
  createDestination,
  deleteDestination,
  recordPing,
  listPings,
  createFeedback,
  listFeedback,
  markFeedbackDelivered,
  createReport,
  listReports,
  countPendingReports,
  handleReport,
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
