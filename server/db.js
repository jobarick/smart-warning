// Persistence layer. Turns the live alert/all-clear stream into durable incident
// records, and backs multi-tenant orgs + supervisor accounts.
//
// Degrades gracefully: with no DATABASE_URL the whole module is a no-op and the
// relay runs exactly as before (in-memory, single global room). Orgs and
// accounts only exist when a database is configured.
const { Pool } = require('pg');
// The plan catalogue is the single source for trial length and trial tier, so
// the schema layer asks it rather than carrying a second copy of both.
const plans = require('./billing/plans');

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
    -- 'resolved' | 'false-alarm'. Nullable: rows that predate the distinction
    -- genuinely do not know which they were, and inventing a value for them
    -- would be worse than admitting it.
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution TEXT;
    -- A supervisor's formal "I have seen this" — distinct from the per-device
    -- siren mute (which never touches the server at all). Nullable and set
    -- exactly once: the UPDATE that sets it only ever matches an incident
    -- that doesn't have it yet, so two supervisors racing to acknowledge the
    -- same alarm produce one acknowledgement, not two, and the loser's tap
    -- still reads back the truth instead of silently overwriting it.
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;
    -- How many times this incident has been re-notified for going
    -- unacknowledged, and when the last one fired — what the escalation sweep
    -- reads to decide whether it is due, so a restart loses no more than the
    -- gap until the next sweep tick, never the fact that escalation happened.
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE incidents ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS incidents_raised_at_idx ON incidents (raised_at DESC);
    CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
    CREATE INDEX IF NOT EXISTS incidents_org_idx ON incidents (org_id);
    -- What the escalation sweep scans every tick: active, unacknowledged incidents.
    CREATE INDEX IF NOT EXISTS incidents_unacked_idx ON incidents (raised_at) WHERE status = 'active' AND acknowledged_at IS NULL;

    -- The append-only history of one incident: what happened and when, so a
    -- supervisor's dashboard — and an auditor afterwards — can reconstruct the
    -- whole thing rather than trust a single mutable "status" field.
    --
    -- Deliberately NOT where "who is currently responding" lives — that stays
    -- in relay.js's in-memory orgResponding map on purpose (see the comment
    -- there): a live claim must vanish on restart rather than survive as a
    -- stale "help is on the way". An event row never makes that claim — it
    -- only records that a message of that kind arrived at that moment, which
    -- stays true forever and is exactly what is safe to persist.
    CREATE TABLE IF NOT EXISTS incident_events (
      id          BIGSERIAL PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      org_id      UUID,
      kind        TEXT NOT NULL, -- raised | responding | acknowledged | escalated | resolved
      actor_name  TEXT,
      actor_role  TEXT,          -- worker | supervisor | system
      detail      JSONB,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events (incident_id, at);
    CREATE INDEX IF NOT EXISTS incident_events_org_idx      ON incident_events (org_id, at DESC);

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

    -- Outbound mail, queued before it is attempted.
    --
    -- Mail is the one delivery channel whose configuration lives entirely
    -- outside the code, so it is also the one most likely to be absent. Rows
    -- accumulate as 'pending' while no provider is configured and drain by
    -- themselves the first time one is, which is what makes "no user action is
    -- ever lost" a property of the database rather than a promise about ops.
    CREATE TABLE IF NOT EXISTS outbound_mail (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id       UUID,
      kind         TEXT NOT NULL DEFAULT 'generic',
      ref_id       TEXT,
      to_addr      TEXT NOT NULL,
      reply_to     TEXT,
      subject      TEXT NOT NULL,
      body         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      attempts     INT  NOT NULL DEFAULT 0,
      last_error   TEXT,
      next_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS outbound_mail_due_idx ON outbound_mail (status, next_attempt);
    -- One row per (kind, ref_id) so a retried submission cannot mail twice.
    CREATE UNIQUE INDEX IF NOT EXISTS outbound_mail_ref_idx
      ON outbound_mail (kind, ref_id) WHERE ref_id IS NOT NULL;

    -- Native push registrations. Separate from push_subscriptions, which holds
    -- browser Web Push endpoints: an FCM token is a different credential with a
    -- different lifecycle, and conflating them would mean one prune killing the
    -- other channel.
    CREATE TABLE IF NOT EXISTS device_tokens (
      token      TEXT PRIMARY KEY,
      org_id     UUID,
      platform   TEXT NOT NULL DEFAULT 'android',
      worker_id  TEXT,
      label      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS device_tokens_org_idx ON device_tokens (org_id);
    -- A personal account belongs to no organisation, so its phone could not be
    -- registered at all: the only owner this table understood was an org, and a
    -- personal registration was refused rather than stored. That made native
    -- push unreachable for every individual subscriber.
    --
    -- Owned by a user instead, and NEVER by a null org. Null org id is not a
    -- free slot — listDeviceTokens matches it with IS NOT DISTINCT FROM, so
    -- storing personal phones that way would have made one broadcast reach
    -- every unrelated personal account at once. That is the same shared-room
    -- mistake relay.js refuses for WebSocket rooms, and it must be refused
    -- here too. See listDeviceTokens, which now excludes user-owned rows.
    ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS user_id UUID
      REFERENCES users(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens (user_id);

    -- Billing ---------------------------------------------------------------
    -- The tier is denormalised onto the organization so the common read — "what
    -- is this site allowed to see" — costs no join, while subscriptions holds
    -- the billing detail behind it.
    -- organizations.tier is the tier the customer is SUBSCRIBED to. What they
    -- are actually SERVED can differ — a payment in flight serves the previous
    -- tier, a lapsed grace period serves free — and billing/entitlements.js is
    -- the only authority on that. Do not use these columns to decide access.
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier                TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS active_seats        INT  NOT NULL DEFAULT 0;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_phone       TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_email       TEXT;

    -- One live subscription per organization. A change of plan updates this row
    -- rather than adding another, so there is never a question about which of
    -- two rows is in force; the payment history lives in transactions.
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tier                 TEXT NOT NULL DEFAULT 'free',
      -- What to fall back to while a payment is still pending. Without it, an
      -- upgrade attempt that is never authorised would have nothing to revert to.
      previous_tier        TEXT NOT NULL DEFAULT 'free',
      status               TEXT NOT NULL DEFAULT 'active',
      payment_method       TEXT,
      provider             TEXT,
      billing_cycle        TEXT NOT NULL DEFAULT 'monthly',
      currency             TEXT NOT NULL DEFAULT 'TZS',
      amount               NUMERIC(14,2),
      billing_phone        TEXT,
      seats                INT,
      reference_id         TEXT,
      external_reference   TEXT,
      current_period_start TIMESTAMPTZ,
      current_period_end   TIMESTAMPTZ,
      past_due_since       TIMESTAMPTZ,
      canceled_at          TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS subscriptions_period_idx ON subscriptions (status, current_period_end);

    -- A subscription belongs to a SUBJECT, which is an organisation or a
    -- person. Until now only organisations could hold one, which is why a
    -- consumer plan could not be sold: there was nothing to sell it to.
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id       UUID REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
    -- 'organization' | 'individual'. Redundant with which id column is set, and
    -- that redundancy is the point: a row states what it is instead of leaving
    -- every reader to infer it from a null. Existing rows are all
    -- organisations, which the default makes true without a backfill.
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'organization';
    ALTER TABLE subscriptions ALTER COLUMN org_id DROP NOT NULL;

    -- One live subscription per subject. Two partial indexes rather than one
    -- over both columns: a composite would happily allow two rows for the same
    -- org as long as their user_id differed, which is exactly the state the
    -- old index existed to prevent.
    DROP INDEX IF EXISTS subscriptions_org_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_subject_org_idx
      ON subscriptions (org_id)  WHERE org_id  IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_subject_user_idx
      ON subscriptions (user_id) WHERE user_id IS NOT NULL;

    -- A person can now exist without an organisation.
    --
    -- 'kind' distinguishes somebody who signed up for themselves from a member
    -- of a site. Both are users, share one auth path, one password rule and one
    -- deletion path — a parallel accounts table would have meant maintaining
    -- all three twice and getting them subtly different.
    ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS kind    TEXT NOT NULL DEFAULT 'org_member';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locale  TEXT NOT NULL DEFAULT 'en';

    -- Every collection attempt, successful or not.
    --
    -- order_reference is ours and is UNIQUE: it is what makes a webhook safe to
    -- receive twice, which mobile money gateways do routinely. The applied flag
    -- whether a paid transaction has already been turned into entitlement, so
    -- provisioning happens exactly once however many callbacks arrive.
    CREATE TABLE IF NOT EXISTS transactions (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id             UUID REFERENCES organizations(id) ON DELETE SET NULL,
      subscription_id    UUID,
      order_reference    TEXT NOT NULL UNIQUE,
      external_reference TEXT,
      provider           TEXT NOT NULL,
      gateway            TEXT NOT NULL DEFAULT 'clickpesa',
      method             TEXT NOT NULL DEFAULT 'mobile_money',
      phone_number       TEXT,
      amount             NUMERIC(14,2) NOT NULL,
      currency           TEXT NOT NULL DEFAULT 'TZS',
      plan_id            TEXT,
      billing_cycle      TEXT NOT NULL DEFAULT 'monthly',
      status             TEXT NOT NULL DEFAULT 'pending',
      raw_status         TEXT,
      message            TEXT,
      applied            BOOLEAN NOT NULL DEFAULT false,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at            TIMESTAMPTZ
    );
    -- At most ONE open mobile money attempt per organization.
    --
    -- The application checks for an existing attempt before pushing, but two
    -- requests arriving together can both pass that check and both insert.
    -- Only the database can settle a race, so this makes the second insert fail
    -- with 23505 and the caller rejoins the first attempt instead. Without it a
    -- double tap can put two USSD prompts on one handset, and a customer who
    -- approves both is charged twice.
    --
    -- Scoped to mobile money on purpose: an abandoned Stripe checkout is
    -- routine, and Stripe's own idempotency key already covers that path.
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_open_per_org
      ON transactions (org_id) WHERE status = 'pending' AND method = 'mobile_money';

    -- Stated here rather than beside the subscriptions changes above, because
    -- init() runs as one ordered script: an ALTER placed before its CREATE
    -- TABLE works on every existing database and fails on every new one.
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    -- The double-charge guard for a person. The org index above is keyed on
    -- org_id and so does nothing at all for a personal account: without this,
    -- one double tap puts two USSD prompts on one handset and a customer who
    -- approves both is charged twice.
    --
    -- Stated AFTER the ALTER that adds the column, for the same reason as the
    -- ALTER itself: init() runs as one ordered script, and an index over a
    -- column that does not exist yet fails on every new database while
    -- succeeding on every existing one.
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_open_per_user
      ON transactions (user_id)
      WHERE status = 'pending' AND method = 'mobile_money' AND user_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS transactions_org_idx     ON transactions (org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS transactions_status_idx  ON transactions (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS transactions_external_idx ON transactions (external_reference);

    -- Record of who accepted which version of the Terms & Conditions.
    --
    -- The app also keeps a localStorage flag, but that only decides whether to
    -- show the screen — it is under the user's own control and proves nothing.
    -- This is the copy an organisation could actually rely on, which is the
    -- entire point of asking somebody to tick four boxes.
    --
    -- Append-only: a later acceptance of a new version is a new row, so the
    -- history of what each person agreed to, and when, stays intact.
    CREATE TABLE IF NOT EXISTS consents (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     UUID,
      subject     TEXT,
      version     TEXT NOT NULL,
      points      TEXT[] NOT NULL DEFAULT '{}',
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS consents_org_idx  ON consents (org_id, accepted_at DESC);
    CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (user_id, accepted_at DESC);

    -- Password reset tickets.
    --
    -- Only the HASH of the token is stored. The token itself exists in exactly
    -- two places — the email that was sent, and the link the person clicks —
    -- so a copy of this table is not a set of working reset links. That matters
    -- more here than in most products: the account being reset can see the live
    -- position of everyone on a site.
    --
    -- Single use and short lived, both enforced in the UPDATE that consumes a
    -- ticket rather than by a read-then-write, so two clicks on the same link
    -- cannot both succeed.
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id, created_at DESC);

    -- The people a personal account has asked to be told when they raise an
    -- alarm.
    --
    -- Scoped to a user and to nothing else. There is no org_id here on
    -- purpose: this is the private list of one person, and an organisation has
    -- its own roster and its own coordinators. Mixing the two would be the
    -- fastest way to send somebody's home emergency to their employer.
    --
    -- 'notify' is a per-contact switch rather than a delete, because a person
    -- may want to keep a number on the list without alarming it every time —
    -- and deleting a contact to silence it is how a number gets lost.
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      relation   TEXT,
      phone      TEXT,
      email      TEXT,
      -- Lower sorts first. This is the order they are told in, and the order
      -- the screen lists them in, so the two can never disagree.
      priority   INT  NOT NULL DEFAULT 1,
      notify     BOOLEAN NOT NULL DEFAULT true,
      -- Set when the person has confirmed the details reach the right human.
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- A contact must be reachable by something, or it is a name that creates
      -- a false sense of cover. Enforced here rather than only in the API,
      -- because this is the promise the whole feature rests on.
      CONSTRAINT emergency_contacts_reachable CHECK (phone IS NOT NULL OR email IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS emergency_contacts_user_idx
      ON emergency_contacts (user_id, priority, created_at);
  `);
  await backfillPublicCodes();
  await linkOrphanTables();
  return true;
}

// Tables that grew an org_id without a foreign key behind it.
//
// incidents, location_pings, feedback, outbound_mail and device_tokens all
// carry an organization id that nothing enforces, because each was added at a
// different time and org_id was bolted on afterwards. Nothing can orphan today
// — there is no code path that deletes an organization — but that is an
// accident of what has not been built yet, not a property of the schema.
//
// It matters because the deletion path is coming: Google Play requires an
// account deletion mechanism for any app offering sign-up, and this one has
// it. On the day that lands, an unconstrained org_id means a deleted customer
// leaves behind their incidents and, worse, their location_pings — precise
// GPS traces of named people, retained after they asked to be forgotten.
//
// CASCADE rather than SET NULL on all five: every one of these tables holds
// personal data, so "delete the organization" has to mean it.
const ORG_FOREIGN_KEYS = [
  { table: 'incidents', constraint: 'incidents_org_fk' },
  { table: 'location_pings', constraint: 'location_pings_org_fk' },
  { table: 'feedback', constraint: 'feedback_org_fk' },
  { table: 'outbound_mail', constraint: 'outbound_mail_org_fk' },
  { table: 'device_tokens', constraint: 'device_tokens_org_fk' },
  // incident_events.incident_id already cascades through incidents, so this is
  // belt-and-braces rather than load-bearing — but org_id is the column every
  // other table in this list constrains, and an event's actor_name/detail is
  // personal data same as the rest.
  { table: 'incident_events', constraint: 'incident_events_org_fk' },
];

async function linkOrphanTables() {
  if (!pool) return;

  for (const { table, constraint } of ORG_FOREIGN_KEYS) {
    // Each in its own try/catch. A failure here must not abort the rest of
    // init(): the schema above is what the running product depends on, and
    // this is hardening for a feature that does not exist yet.
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
        [constraint],
      );
      if (rows.length > 0) continue;

      // Adding the constraint fails outright if any row already points at an
      // organization that is gone, so clear those first. They are unreachable
      // records — every query in this file is org-scoped — so detaching them
      // loses nothing that was being read.
      const { rowCount } = await pool.query(
        `UPDATE ${table} SET org_id = NULL
         WHERE org_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = ${table}.org_id)`,
      );
      if (rowCount > 0) {
        console.warn(`[db] ${table}: detached ${rowCount} row(s) pointing at a missing organization`);
      }

      await pool.query(
        `ALTER TABLE ${table}
         ADD CONSTRAINT ${constraint} FOREIGN KEY (org_id)
         REFERENCES organizations(id) ON DELETE CASCADE`,
      );
      console.log(`[db] ${table}: org_id now references organizations`);
    } catch (e) {
      console.error(`[db] could not add ${constraint} to ${table}: ${e.message}`);
    }
  }

  // users.org_id is queried on every seat count and has no index of its own.
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id)`);
  } catch (e) {
    console.error(`[db] could not index users.org_id: ${e.message}`);
  }
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

// A person with no organisation. org_id stays null, which the schema now
// allows; kind says so explicitly rather than leaving readers to infer it.
async function createIndividual({ email, passwordHash, name, phone = null, country = null }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO users (org_id, email, password_hash, name, role, phone, kind, country)
     VALUES (NULL, $1, $2, $3, 'individual', $4, 'individual', $5) RETURNING *`,
    [email.toLowerCase(), passwordHash, name, phone, country],
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

// --- Password reset ---------------------------------------------------------

async function createPasswordReset({ tokenHash, userId, expiresAt }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO password_resets (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO NOTHING
     RETURNING *`,
    [tokenHash, userId, expiresAt],
  );
  return rows[0] || null;
}

/**
 * Spend a reset ticket, returning the user it belongs to.
 *
 * The unused/unexpired test lives in the UPDATE's WHERE clause on purpose: a
 * reset link that is clicked twice — which happens routinely, because mail
 * clients prefetch links — must succeed exactly once. Reading the row first and
 * then updating it would let two requests both pass the check.
 */
async function consumePasswordReset(tokenHash) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE password_resets
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  return getUserById(rows[0].user_id);
}

/**
 * Set a new password and retire every outstanding ticket for that account.
 *
 * Both halves matter. Somebody who has just recovered an account may have
 * requested several links while working out which email arrived; leaving the
 * others live would mean an old message in an inbox still grants entry.
 */
async function setUserPassword(userId, passwordHash) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *`,
    [userId, passwordHash],
  );
  if (!rows[0]) return null;
  await pool.query(
    `UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return rows[0];
}

// --- Personal emergency contacts -------------------------------------------
//
// Every function here takes the owner's user id and uses it in the WHERE
// clause, including the updates and the delete. Not a convenience: it is what
// makes it impossible for one person to read or change another's list by
// guessing a row id.

function publicContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    relation: row.relation || null,
    phone: row.phone || null,
    email: row.email || null,
    priority: row.priority,
    notify: row.notify === true,
    verifiedAt: row.verified_at || null,
  };
}

async function listContacts(userId) {
  if (!pool || !userId) return [];
  const { rows } = await pool.query(
    `SELECT * FROM emergency_contacts WHERE user_id = $1
      ORDER BY priority ASC, created_at ASC LIMIT 20`,
    [userId],
  );
  return rows.map(publicContact);
}

/** The contacts that should actually be told, in the order they are told. */
async function listNotifiableContacts(userId) {
  if (!pool || !userId) return [];
  const { rows } = await pool.query(
    `SELECT * FROM emergency_contacts
      WHERE user_id = $1 AND notify = true
      ORDER BY priority ASC, created_at ASC LIMIT 20`,
    [userId],
  );
  return rows.map(publicContact);
}

async function createContact({ userId, name, relation, phone, email, priority, notify }) {
  if (!pool) throw new Error('persistence disabled');
  const { rows } = await pool.query(
    `INSERT INTO emergency_contacts (user_id, name, relation, phone, email, priority, notify)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 1), COALESCE($7, true)) RETURNING *`,
    [userId, name, relation ?? null, phone ?? null, email ?? null, priority ?? null, notify ?? null],
  );
  return publicContact(rows[0]);
}

const CONTACT_FIELDS = {
  name: 'name', relation: 'relation', phone: 'phone', email: 'email',
  priority: 'priority', notify: 'notify', verifiedAt: 'verified_at',
};

async function updateContact(id, userId, patch = {}) {
  if (!pool || !userId) return null;
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(CONTACT_FIELDS)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) return null;
  values.push(id, userId);
  const { rows } = await pool.query(
    `UPDATE emergency_contacts SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
    values,
  );
  return publicContact(rows[0]);
}

async function deleteContact(id, userId) {
  if (!pool || !userId) return null;
  const { rows } = await pool.query(
    `DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return rows[0] || null;
}

async function countContacts(userId) {
  if (!pool || !userId) return 0;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM emergency_contacts WHERE user_id = $1`, [userId],
  );
  return rows[0].n;
}

// --- Incidents (all scoped to an org) --------------------------------------

// Record a raised alert. `worker` is the triggering device's roster entry (if
// known), the source of the alert's location — the wire alert carries none.
/**
 * Store an alert as an incident.
 *
 * Returns true only when a NEW row was written. A device replaying its outbox
 * re-sends the same alert with the same id, so the ON CONFLICT below is the
 * point at which a duplicate becomes harmless — and the return value is what
 * lets the caller avoid pushing the same emergency to everyone's lock screen a
 * second time.
 */
async function recordAlert(alert, worker, orgId) {
  if (!pool) return false;
  const ts = numOrNull(alert.timestamp) ?? Date.now();
  const res = await pool.query(
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
  return res.rowCount > 0;
}

// Resolve the active incident(s) for one org only.
async function resolveActive(allClear, orgId) {
  if (!pool) return;
  const ts = numOrNull(allClear.timestamp) ?? Date.now();
  // `resolution` separates a real incident that ended from one that was
  // withdrawn as a mistake. Both leave status='resolved' so every existing
  // query and stat keeps working; the distinction is additive.
  const resolution = allClear.reason === 'false-alarm' ? 'false-alarm' : 'resolved';
  await pool.query(
    `UPDATE incidents
        SET status = 'resolved', resolved_at = to_timestamp($1 / 1000.0),
            resolved_by = $2, resolution = $4
      WHERE status = 'active' AND org_id IS NOT DISTINCT FROM $3`,
    [ts, allClear.sender || null, orgId || null, resolution],
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

// --- Incident lifecycle: audit trail, acknowledgement, escalation ----------

/**
 * Append one fact to an incident's history. Never fails the caller: every
 * call site is a side effect of something that already happened (an alert
 * went out, a supervisor tapped acknowledge), so a write error here must not
 * unwind whatever real action just occurred. Callers still get the error via
 * the rejected promise if they want to log it.
 */
async function recordIncidentEvent({ incidentId, orgId = null, kind, actorName = null, actorRole = null, detail = null }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO incident_events (incident_id, org_id, kind, actor_name, actor_role, detail)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [String(incidentId), orgId || null, String(kind), actorName, actorRole, detail ? JSON.stringify(detail) : null],
  );
  return rows[0] || null;
}

async function listIncidentEvents(incidentId, orgId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT e.* FROM incident_events e
     JOIN incidents i ON i.id = e.incident_id
     WHERE e.incident_id = $1 AND i.org_id IS NOT DISTINCT FROM $2
     ORDER BY e.at ASC`,
    [String(incidentId), orgId || null],
  );
  return rows;
}

/**
 * A supervisor's formal acknowledgement. Returns the updated row on success,
 * or null when there was nothing to claim — already acknowledged, already
 * resolved, or no such incident in this org. The `WHERE` clause is the whole
 * safety property: it matches only a row that is still open and unclaimed, so
 * two supervisors tapping at once produce exactly one acknowledgement, and the
 * one who loses the race reads back the truth (who actually got there first)
 * instead of silently overwriting it.
 */
async function acknowledgeIncident({ id, orgId, by }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE incidents
        SET acknowledged_at = now(), acknowledged_by = $3
      WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2
        AND status = 'active' AND acknowledged_at IS NULL
      RETURNING *`,
    [String(id), orgId || null, by || null],
  );
  return rows[0] || null;
}

/**
 * What the escalation sweep acts on: active incidents nobody has acknowledged
 * yet, old enough for the next escalation and not escalated past the cap.
 * Driven entirely by timestamps already on the row, so a server restart loses
 * at most the wait until the next sweep tick — never the fact that an
 * incident is overdue, which is exactly the property this feature exists for.
 */
async function listEscalationDue({ afterMs, maxLevel }) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM incidents
      WHERE status = 'active' AND acknowledged_at IS NULL
        AND escalation_level < $2
        AND COALESCE(last_escalated_at, raised_at) < now() - ($1 || ' milliseconds')::interval
      ORDER BY raised_at ASC
      LIMIT 200`,
    [String(afterMs), maxLevel],
  );
  return rows;
}

async function bumpEscalation(id) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE incidents
        SET escalation_level = escalation_level + 1, last_escalated_at = now()
      WHERE id = $1
      RETURNING *`,
    [String(id)],
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

// Remove a subscription. When orgId is given the delete is scoped to that
// organization, so possessing an endpoint string is not on its own enough to
// switch off someone else's emergency notifications.
//
// orgId is omitted only by the push sender pruning an endpoint the push
// service itself has reported as gone (404/410), which is authoritative.
async function deletePushSubscription(endpoint, orgId = null) {
  if (!pool) return 0;
  const { rowCount } = orgId
    ? await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND org_id = $2`, [endpoint, orgId])
    : await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  return rowCount;
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

// --- Outbound mail queue ---------------------------------------------------

/**
 * Queue one message. `refId` makes the write idempotent: a resubmitted feedback
 * row or a retried request cannot produce two emails about the same thing.
 * Returns the row, or null when persistence is off (the caller then decides
 * whether a direct, unqueued attempt is worth making).
 */
async function queueMail({ orgId = null, kind = 'generic', refId = null, to, replyTo = null, subject, body }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO outbound_mail (org_id, kind, ref_id, to_addr, reply_to, subject, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kind, ref_id) WHERE ref_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [orgId, kind, refId, to, replyTo, subject, body],
  );
  return rows[0] || null;
}

/**
 * Claim messages that are due for an attempt.
 *
 * The UPDATE … RETURNING is the claim: it moves the row's next attempt forward
 * before handing it out, so two server instances draining concurrently cannot
 * both send the same email.
 */
async function claimDueMail(limit = 20, leaseMs = 60_000) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `UPDATE outbound_mail SET next_attempt = now() + ($2 || ' milliseconds')::interval
      WHERE id IN (
        SELECT id FROM outbound_mail
         WHERE status = 'pending' AND next_attempt <= now()
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [Math.min(Math.max(1, limit), 200), String(leaseMs)],
  );
  return rows;
}

async function markMailSent(id) {
  if (!pool) return;
  await pool.query(
    `UPDATE outbound_mail SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
      WHERE id = $1`,
    [id],
  );
}

/**
 * Record a failed attempt and schedule the next one.
 *
 * Backoff is capped rather than unbounded, and the row stays 'pending' however
 * many times it fails: a message that cannot be delivered today because nobody
 * has configured SMTP must still go out the day somebody does. `giveUpAfter`
 * exists only for permanent rejections, which the caller identifies.
 */
async function markMailFailed(id, error, { backoffMs = 60_000, permanent = false } = {}) {
  if (!pool) return;
  await pool.query(
    `UPDATE outbound_mail
        SET attempts = attempts + 1,
            last_error = $2,
            status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
            next_attempt = now() + ($3 || ' milliseconds')::interval
      WHERE id = $1`,
    [id, String(error || '').slice(0, 500), String(backoffMs), permanent],
  );
}

async function mailQueueStats() {
  if (!pool) return { pending: 0, sent: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM outbound_mail GROUP BY status`,
  );
  const out = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows) if (r.status in out) out[r.status] = r.n;
  return out;
}

// --- Native push tokens ----------------------------------------------------

// A token is owned by exactly one subject: an organisation, or a person.
//
// The upsert overwrites BOTH owner columns on conflict, which is what makes a
// handset safe to hand over or re-use. Signing in as someone else re-registers
// the same FCM token, and the previous owner's claim on it has to disappear in
// the same statement — otherwise the phone would keep receiving the alerts of
// an account its holder has left.
async function saveDeviceToken({ token, orgId = null, userId = null, platform = 'android', workerId = null, label = null }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO device_tokens (token, org_id, user_id, platform, worker_id, label)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (token) DO UPDATE
       SET org_id = EXCLUDED.org_id, user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           worker_id = EXCLUDED.worker_id, label = EXCLUDED.label, seen_at = now()
     RETURNING *`,
    [token, orgId, userId, platform, workerId, label],
  );
  return rows[0] || null;
}

// Every phone registered to one organisation.
//
// `user_id IS NULL` is load-bearing, not tidiness. The org match is
// IS NOT DISTINCT FROM so that legacy single-room deployments (org id null)
// still work, and without this second clause a null-org broadcast would sweep
// up every personal account's handset and deliver one stranger's emergency to
// all of them. Personal registrations are read by listDeviceTokensForUser.
async function listDeviceTokens(orgId) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT token, platform FROM device_tokens
      WHERE org_id IS NOT DISTINCT FROM $1 AND user_id IS NULL`,
    [orgId],
  );
  return rows;
}

// Scoped the same way as deletePushSubscription: holding a registration token
// must not be sufficient to unregister a device from its owner's alerts.
//
// An owner is now required. This used to fall back to deleting by token alone
// whenever no org id was supplied, which was safe only because the sole caller
// rejected the request first. Personal accounts have no org id, so that
// fallback would have become reachable the moment they could register — and
// possession of a token string would have been enough to silence anyone's
// phone. Pruning tokens FCM has declared dead is a different operation with
// no owner to check: it goes through deleteDeviceTokens.
async function deleteDeviceToken(token, owner = {}) {
  if (!pool) return 0;
  const { orgId = null, userId = null } = owner;
  if (userId) {
    const { rowCount } = await pool.query(
      `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`, [token, userId],
    );
    return rowCount;
  }
  if (orgId) {
    const { rowCount } = await pool.query(
      `DELETE FROM device_tokens WHERE token = $1 AND org_id = $2 AND user_id IS NULL`, [token, orgId],
    );
    return rowCount;
  }
  return 0;
}

/** Every phone registered to one person. The personal counterpart of listDeviceTokens. */
async function listDeviceTokensForUser(userId) {
  if (!pool || !userId) return [];
  const { rows } = await pool.query(
    `SELECT token, platform FROM device_tokens WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

/** Drop tokens the push service has told us are dead, in one round trip. */
async function deleteDeviceTokens(tokens) {
  if (!pool || !tokens.length) return;
  await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [tokens]);
}

async function countDeviceTokens() {
  if (!pool) return 0;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM device_tokens`);
  return rows[0]?.n || 0;
}

// --- Live location tracking ------------------------------------------------

// One position sample for a worker during a live incident. Cheap and additive:
// the roster already carries these coordinates, this just makes them durable so
// movement can be replayed afterwards.
// `at` is optional and defaults to now(). It is supplied only when a device
// hands over positions it buffered while offline — those have to keep the time
// they were actually taken, or a backfilled trail would collapse into a single
// instant at the moment the phone found signal again.
async function recordPing({ orgId, incidentId, workerId, workerName, lat, lng, accuracy, at = null }) {
  if (!pool) return;
  const ts = numOrNull(at);
  await pool.query(
    `INSERT INTO location_pings (org_id, incident_id, worker_id, worker_name, lat, lng, accuracy, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE(to_timestamp($8 / 1000.0), now()))`,
    [orgId || null, incidentId || null, String(workerId), workerName || null, lat, lng, numOrNull(accuracy), ts],
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

// --- Billing: subscriptions & transactions ---------------------------------

// Shape a subscriptions row for the billing code, which thinks in camelCase and
// should never have to know this table's column names.
function publicSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind ?? 'organization',
    orgId: row.org_id,
    userId: row.user_id ?? null,
    tier: row.tier,
    previousTier: row.previous_tier,
    trialEndsAt: row.trial_ends_at ?? null,
    status: row.status,
    paymentMethod: row.payment_method,
    provider: row.provider,
    billingCycle: row.billing_cycle,
    currency: row.currency,
    amount: row.amount == null ? null : Number(row.amount),
    billingPhone: row.billing_phone,
    seats: row.seats,
    referenceId: row.reference_id,
    externalReference: row.external_reference,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    pastDueSince: row.past_due_since,
    canceledAt: row.canceled_at,
    updatedAt: row.updated_at,
  };
}

async function getSubscription(orgId) {
  if (!pool || !orgId) return null;
  const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE org_id = $1`, [orgId]);
  return publicSubscription(rows[0]);
}

// Every org gets a row, including free ones. A missing row and a free plan
// would otherwise be indistinguishable, and the billing code would have to
// handle null everywhere it handles 'free'.
//
// A row created here starts the free month. Existing rows are untouched — the
// ON CONFLICT is a no-op update — so switching this on does not retroactively
// put every organisation already using the product into a trial that will
// later expire underneath them.
//
// The conflict target names the partial index's predicate, because that is the
// index Postgres has to infer; without WHERE org_id IS NOT NULL this raises
// "no unique or exclusion constraint matching the ON CONFLICT specification".
async function ensureSubscription(orgId) {
  if (!pool || !orgId) return null;
  const tier = plans.TRIAL_TIER.org;
  const trialEnds = new Date(Date.now() + plans.TRIAL_DAYS * 86400000);
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (org_id, kind, tier, previous_tier, status, trial_ends_at)
     VALUES ($1, 'organization', $2, 'free', 'trialing', $3)
     ON CONFLICT (org_id) WHERE org_id IS NOT NULL
       DO UPDATE SET org_id = EXCLUDED.org_id
     RETURNING *`,
    [orgId, tier, trialEnds],
  );
  return publicSubscription(rows[0]);
}

// The same, for a person rather than a site.
async function ensureUserSubscription(userId) {
  if (!pool || !userId) return null;
  const tier = plans.TRIAL_TIER.individual;
  const trialEnds = new Date(Date.now() + plans.TRIAL_DAYS * 86400000);
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (user_id, kind, tier, previous_tier, status, trial_ends_at)
     VALUES ($1, 'individual', $2, 'free', 'trialing', $3)
     ON CONFLICT (user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, tier, trialEnds],
  );
  return publicSubscription(rows[0]);
}

async function getUserSubscription(userId) {
  if (!pool || !userId) return null;
  const { rows } = await pool.query(
    // kind is asserted as well as user_id. Belt and braces: a row that somehow
    // carried both ids must never be served to the wrong subject.
    `SELECT * FROM subscriptions WHERE user_id = $1 AND kind = 'individual'`,
    [userId],
  );
  return publicSubscription(rows[0]);
}

async function updateUserSubscription(userId, patch = {}) {
  if (!pool || !userId) return null;
  await ensureUserSubscription(userId);

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(SUBSCRIPTION_FIELDS)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return getUserSubscription(userId);

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE subscriptions SET ${sets.join(', ')}, updated_at = now()
      WHERE user_id = $${values.length} AND kind = 'individual' RETURNING *`,
    values,
  );
  // Deliberately no mirror onto organizations: a person's plan is not a site's.
  return publicSubscription(rows[0]);
}

/**
 * The one lookup the rest of the server should use.
 *
 * A subject is a person OR an organisation, never both and never inferred. The
 * caller states which, so there is no code path where a lookup falls back from
 * one to the other — that fallback is how one customer ends up being served
 * another's entitlements.
 */
function subscriptionsFor(subject) {
  if (!subject) return null;
  if (subject.kind === 'individual' && subject.userId) {
    return {
      get: () => getUserSubscription(subject.userId),
      ensure: () => ensureUserSubscription(subject.userId),
      update: (patch) => updateUserSubscription(subject.userId, patch),
    };
  }
  if (subject.kind === 'organization' && subject.orgId) {
    return {
      get: () => getSubscription(subject.orgId),
      ensure: () => ensureSubscription(subject.orgId),
      update: (patch) => updateSubscription(subject.orgId, patch),
    };
  }
  return null;
}

// Partial update by column allow-list. Written this way because the callers
// legitimately change different subsets — a pending push sets one group of
// fields, a successful payment another — and a fixed-arity update would force
// every caller to restate values it has no opinion about.
const SUBSCRIPTION_FIELDS = {
  tier: 'tier',
  previousTier: 'previous_tier',
  status: 'status',
  paymentMethod: 'payment_method',
  provider: 'provider',
  billingCycle: 'billing_cycle',
  currency: 'currency',
  amount: 'amount',
  billingPhone: 'billing_phone',
  seats: 'seats',
  referenceId: 'reference_id',
  externalReference: 'external_reference',
  currentPeriodStart: 'current_period_start',
  currentPeriodEnd: 'current_period_end',
  pastDueSince: 'past_due_since',
  canceledAt: 'canceled_at',
  trialEndsAt: 'trial_ends_at',
};

async function updateSubscription(orgId, patch = {}) {
  if (!pool || !orgId) return null;
  await ensureSubscription(orgId);

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(SUBSCRIPTION_FIELDS)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return getSubscription(orgId);

  values.push(orgId);
  const { rows } = await pool.query(
    `UPDATE subscriptions SET ${sets.join(', ')}, updated_at = now()
     WHERE org_id = $${values.length} RETURNING *`,
    values,
  );

  // Keep the organizations mirror in step. This is the SUBSCRIBED tier and
  // status — a reporting convenience, deliberately not an access decision.
  if (patch.tier !== undefined || patch.status !== undefined) {
    const row = rows[0];
    await pool.query(
      `UPDATE organizations SET tier = $1, subscription_status = $2 WHERE id = $3`,
      [row.tier, row.status, orgId],
    );
  }
  return publicSubscription(rows[0]);
}

function publicTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    // Which subject paid. A transaction names its own, so provisioning never
    // has to guess whose subscription to activate.
    userId: row.user_id ?? null,
    orderReference: row.order_reference,
    externalReference: row.external_reference,
    provider: row.provider,
    gateway: row.gateway,
    method: row.method,
    phoneNumber: row.phone_number,
    amount: row.amount == null ? null : Number(row.amount),
    currency: row.currency,
    planId: row.plan_id,
    billingCycle: row.billing_cycle,
    status: row.status,
    rawStatus: row.raw_status,
    message: row.message,
    applied: row.applied,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
  };
}

// Returns null when the org already has an open mobile money attempt — the
// partial unique index above rejects the insert. The caller treats that as
// "rejoin the attempt already in flight", not as an error.
async function createTransaction(tx) {
  if (!pool) throw new Error('persistence disabled');
  try {
    return await insertTransaction(tx);
  } catch (e) {
    if (e.code === '23505') return null;
    throw e;
  }
}

async function insertTransaction(tx) {
  const { rows } = await pool.query(
    `INSERT INTO transactions
       (org_id, user_id, subscription_id, order_reference, external_reference, provider, gateway,
        method, phone_number, amount, currency, plan_id, billing_cycle, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      tx.orgId ?? null,
      tx.userId ?? null,
      tx.subscriptionId ?? null,
      tx.orderReference,
      tx.externalReference ?? null,
      tx.provider,
      tx.gateway ?? 'clickpesa',
      tx.method ?? 'mobile_money',
      tx.phoneNumber ?? null,
      tx.amount,
      tx.currency ?? 'TZS',
      tx.planId ?? null,
      tx.billingCycle ?? 'monthly',
      tx.status ?? 'pending',
    ],
  );
  return publicTransaction(rows[0]);
}

async function getTransactionByReference(orderReference) {
  if (!pool || !orderReference) return null;
  const { rows } = await pool.query(`SELECT * FROM transactions WHERE order_reference = $1`, [orderReference]);
  return publicTransaction(rows[0]);
}

async function listTransactions({ orgId, limit = 50 } = {}) {
  if (!pool) return [];
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT * FROM transactions WHERE org_id IS NOT DISTINCT FROM $1
     ORDER BY created_at DESC LIMIT $2`,
    [orgId ?? null, capped],
  );
  return rows.map(publicTransaction);
}

// Record what the gateway now says about a transaction.
//
// paid_at is only ever set once (COALESCE), so a later SETTLED callback after
// an earlier SUCCESS does not move the moment the customer actually paid.
async function updateTransactionStatus({
  orderReference, status, rawStatus = null, externalReference = null,
  message = null, phoneNumber = null, provider = null,
}) {
  if (!pool || !orderReference) return null;
  const { rows } = await pool.query(
    `UPDATE transactions SET
       status             = $2,
       raw_status         = COALESCE($3, raw_status),
       external_reference = COALESCE($4, external_reference),
       message            = COALESCE($5, message),
       phone_number       = COALESCE($6, phone_number),
       provider           = COALESCE($7, provider),
       paid_at            = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
       updated_at         = now()
     WHERE order_reference = $1
     RETURNING *`,
    [orderReference, status, rawStatus, externalReference, message, phoneNumber, provider],
  );
  return publicTransaction(rows[0]);
}

// Claim a paid transaction for provisioning.
//
// Returns true exactly once per transaction, however many webhook deliveries,
// polls or manual retries race here — the WHERE clause is the lock. Everything
// that grants entitlement hangs off this returning true.
async function claimTransactionForProvisioning(orderReference) {
  if (!pool || !orderReference) return false;
  const { rowCount } = await pool.query(
    `UPDATE transactions SET applied = true, updated_at = now()
     WHERE order_reference = $1 AND status = 'paid' AND applied = false`,
    [orderReference],
  );
  return rowCount > 0;
}

// Undo the claim, so a provisioning attempt that threw can be retried rather
// than leaving a paid customer with nothing.
async function releaseTransactionClaim(orderReference) {
  if (!pool || !orderReference) return;
  await pool.query(
    `UPDATE transactions SET applied = false, updated_at = now() WHERE order_reference = $1`,
    [orderReference],
  );
}

// The org's most recent still-open payment attempt, if it is recent enough to
// still be live on someone's handset. Used to make a second tap on "Pay" join
// the attempt already in flight instead of raising another USSD push — two
// prompts for one subscription is how a customer gets charged twice.
async function findOpenTransactionForOrg(orgId, withinMs) {
  if (!pool || !orgId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM transactions
     WHERE org_id = $1 AND status = 'pending'
       AND created_at > now() - ($2 || ' milliseconds')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [orgId, String(Math.max(0, Math.floor(withinMs)))],
  );
  return publicTransaction(rows[0]);
}

/** The same question for a person: is a prompt already on their handset? */
async function findOpenTransactionForUser(userId, withinMs) {
  if (!pool || !userId) return null;
  const { rows } = await pool.query(
    `SELECT * FROM transactions
     WHERE user_id = $1 AND status = 'pending'
       AND created_at > now() - ($2 || ' milliseconds')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [userId, String(Math.max(0, Math.floor(withinMs)))],
  );
  return publicTransaction(rows[0]);
}

/** Open attempt for either subject, chosen by the stated kind. */
async function findOpenTransactionForSubject(subject, withinMs) {
  if (!subject) return null;
  if (subject.kind === 'individual') return findOpenTransactionForUser(subject.userId, withinMs);
  if (subject.kind === 'organization') return findOpenTransactionForOrg(subject.orgId, withinMs);
  return null;
}

async function listUserTransactions({ userId, limit = 20 } = {}) {
  if (!pool || !userId) return [];
  const { rows } = await pool.query(
    `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 20, 1), 100)],
  );
  return rows.map(publicTransaction);
}

// Transactions still awaiting an answer, oldest first. The reconciler polls
// these: a USSD push whose webhook never arrives must not strand a customer who
// has already entered their PIN.
async function listPendingTransactions({ olderThanMs = 60_000, limit = 50 } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM transactions
     WHERE status = 'pending' AND created_at < now() - ($1 || ' milliseconds')::interval
     ORDER BY created_at ASC LIMIT $2`,
    [String(Math.max(0, Math.floor(olderThanMs))), Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map(publicTransaction);
}

// Cache the seat count worked out by the caller (registered accounts + devices
// currently in the room). Reporting only — nothing reads it to refuse anyone;
// see the seat comment in billing/entitlements.js.
async function setActiveSeats(orgId, seats) {
  if (!pool || !orgId) return;
  await pool.query(`UPDATE organizations SET active_seats = $1 WHERE id = $2`, [Math.max(0, Math.floor(seats) || 0), orgId]);
}

// Registered accounts in an org. Combined with the live roster by the caller to
// estimate seats in use — see the seat comment in billing/entitlements.js.
async function countUsers(orgId) {
  if (!pool || !orgId) return 0;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE org_id = $1`, [orgId]);
  return rows[0] ? rows[0].n : 0;
}

// Subscriptions whose paid period has elapsed. Driven by the same sweep as the
// reconciler; a period that ends is a billing event, not a login-time check,
// or an org nobody signs into would stay active forever.
async function listExpiredSubscriptions(limit = 100) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM subscriptions
     WHERE status = 'active' AND tier <> 'free'
       AND current_period_end IS NOT NULL AND current_period_end < now()
     ORDER BY current_period_end ASC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map(publicSubscription);
}

// --- Account deletion ------------------------------------------------------

/**
 * Delete an organization and everything belonging to it.
 *
 * Google Play requires an app that offers account creation to offer account
 * deletion, and a person who asks to be forgotten should actually be. One
 * statement is enough because every table carrying org_id now has a foreign
 * key with ON DELETE CASCADE behind it — users, push subscriptions, reports,
 * destinations, subscriptions, consents, incidents, location_pings, feedback,
 * outbound_mail and device_tokens all go with it.
 *
 * transactions are the deliberate exception: their org_id is ON DELETE SET
 * NULL, so the financial record survives the account it belonged to, which
 * accounting rules require and which holds no location or identity data.
 *
 * Returns what was removed, so the caller can tell the user plainly rather
 * than saying "done".
 */
async function deleteOrg(orgId) {
  if (!pool || !orgId) return null;

  // Counted before the delete, because afterwards there is nothing to count.
  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users          WHERE org_id = $1)::int AS users,
       (SELECT COUNT(*) FROM incidents      WHERE org_id = $1)::int AS incidents,
       (SELECT COUNT(*) FROM location_pings WHERE org_id = $1)::int AS location_points,
       (SELECT COUNT(*) FROM reports        WHERE org_id = $1)::int AS reports`,
    [orgId],
  );

  // Same scrub, and for the same reason, as the personal path below: the
  // number that paid is a personal identifier the accounting record does not
  // need, and org_id is SET NULL so it cannot be found afterwards.
  await pool.query(
    `UPDATE transactions SET phone_number = NULL WHERE org_id = $1 AND phone_number IS NOT NULL`,
    [orgId],
  );

  const { rowCount } = await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  if (rowCount === 0) return null;
  return counts[0];
}

/**
 * Delete one person's account and everything held with it.
 *
 * The organisation path above cannot serve a personal account: an individual
 * belongs to no organisation, so deleteOrg has nothing to delete for them.
 * Google Play requires an account deletion mechanism from any app that offers
 * sign-up, and personal accounts are on sale — so without this the product
 * both fails that requirement and makes a promise the deletion page cannot
 * keep.
 *
 * Everything personal cascades from users(id): emergency contacts, device
 * tokens, the subscription, consent records. transactions are the same
 * deliberate exception as for organisations — ON DELETE SET NULL, so the
 * financial record survives the account it belonged to, carrying no identity
 * or location data with it.
 *
 * Returns what was removed so the caller can say plainly what happened.
 */
async function deleteUser(userId) {
  if (!pool || !userId) return null;

  // Counted first; afterwards there is nothing left to count.
  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM emergency_contacts WHERE user_id = $1)::int AS contacts,
       (SELECT COUNT(*) FROM device_tokens      WHERE user_id = $1)::int AS devices,
       (SELECT COUNT(*) FROM subscriptions      WHERE user_id = $1)::int AS subscriptions`,
    [userId],
  );

  // Scrub the payer's number from the financial records BEFORE the delete,
  // while the link that finds them still exists — user_id is ON DELETE SET
  // NULL, so afterwards there is no way to tell whose these were.
  //
  // The deletion page promises that retained payment records "contain no
  // personal identifiers beyond the transaction itself". A full mobile number
  // is exactly such an identifier, and accounting needs the amount, currency,
  // date, plan and reference — never the number that paid.
  await pool.query(
    `UPDATE transactions SET phone_number = NULL WHERE user_id = $1 AND phone_number IS NOT NULL`,
    [userId],
  );

  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  if (rowCount === 0) return null;
  return counts[0];
}

// --- Terms & Conditions acceptance -----------------------------------------

async function recordConsent({ orgId = null, userId = null, subject = null, version, points = [] }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO consents (org_id, user_id, subject, version, points)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orgId, userId, subject, version, points],
  );
  return rows[0] || null;
}

async function listConsents({ orgId, limit = 100 } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM consents WHERE org_id IS NOT DISTINCT FROM $1
     ORDER BY accepted_at DESC LIMIT $2`,
    [orgId ?? null, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows;
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
  queueMail,
  claimDueMail,
  markMailSent,
  markMailFailed,
  mailQueueStats,
  saveDeviceToken,
  listDeviceTokens,
  listDeviceTokensForUser,
  deleteDeviceToken,
  deleteDeviceTokens,
  countDeviceTokens,
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
  getSubscription,
  ensureSubscription,
  updateSubscription,
  createTransaction,
  getTransactionByReference,
  listTransactions,
  updateTransactionStatus,
  claimTransactionForProvisioning,
  releaseTransactionClaim,
  listPendingTransactions,
  findOpenTransactionForOrg,
  listExpiredSubscriptions,
  recordConsent,
  listConsents,
  deleteOrg,
  deleteUser,
  countUsers,
  setActiveSeats,
  createUser,
  createIndividual,
  getUserByEmail,
  getUserById,
  createPasswordReset,
  consumePasswordReset,
  setUserPassword,
  ensureUserSubscription,
  getUserSubscription,
  updateUserSubscription,
  subscriptionsFor,
  findOpenTransactionForUser,
  findOpenTransactionForSubject,
  listUserTransactions,
  listContacts,
  listNotifiableContacts,
  createContact,
  updateContact,
  deleteContact,
  countContacts,
  recordAlert,
  resolveActive,
  listIncidents,
  getIncident,
  recordIncidentEvent,
  listIncidentEvents,
  acknowledgeIncident,
  listEscalationDue,
  bumpEscalation,
  stats,
  createPushSubscription,
  listPushSubscriptions,
  deletePushSubscription,
  getKv,
  setKv,
  close,
};
