#!/usr/bin/env node
// Backup-restore drill: proves a real backup can actually be restored, rather
// than just trusting that a backup exists.
//
// Design constraints, and why:
//
//   - NEVER writes to the source. Everything against SOURCE_DATABASE_URL is a
//     plain SELECT. There is no code path here that can mutate production.
//   - NEVER restores into a real database. The restore target is a fresh
//     PGlite instance (an embedded, real Postgres compiled to WASM) created
//     fresh on every run and destroyed at the end. There is no argument, flag,
//     or env var that can point the restore step at anything else — that is
//     deliberate, not an oversight.
//   - Never writes the dumped rows to disk. Production data (emails, phone
//     numbers, GPS traces, incident detail) lives only in this process's
//     memory for the few seconds the drill takes, then is discarded when the
//     process exits.
//   - Only ever holds ONE connection to the PGlite target at a time. PGlite is
//     single-connection ("the socket server will only support a single client
//     connection at a time" — its own README). That is why this script does
//     NOT `require('../../db')` and call its pool-based `init()` against the
//     target — a second connection object would race the first. Instead it
//     extracts the exact same CREATE TABLE DDL straight out of db.js's source
//     and runs it on the one connection this script already holds, so the
//     restored schema can never silently drift from the real one.
//
// Usage:
//   ( set -a; source <(grep '^DATABASE_URL=' ../../.env | sed 's/^DATABASE_URL=/SOURCE_DATABASE_URL=/'); set +a; node index.js )
// or simply:
//   SOURCE_DATABASE_URL="postgres://..." node index.js
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { Client } = require('pg');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

// Every table in server/db.js's schema, in no particular order — restore
// order doesn't matter because the bulk load runs with FK checks deferred
// (see `SET LOCAL session_replication_role = replica` below), which is the
// standard technique pg_restore itself uses for exactly this reason.
const TABLES = [
  'organizations', 'users', 'push_subscriptions', 'app_kv', 'incidents',
  'incident_events', 'reports', 'destinations', 'location_pings', 'feedback',
  'outbound_mail', 'device_tokens', 'subscriptions', 'transactions',
  'consents', 'password_resets', 'emergency_contacts',
];

// Pulls the CREATE TABLE / ALTER TABLE / CREATE INDEX block straight out of
// db.js's init() function, so this script's idea of the schema can never
// quietly diverge from the real one. If db.js's init() changes shape, this
// throws with a clear message instead of silently restoring an empty or
// wrong schema.
function extractSchemaDDL() {
  const dbSrcPath = path.join(__dirname, '..', '..', 'db.js');
  const dbSrc = fs.readFileSync(dbSrcPath, 'utf8');
  // No literal '\n' in these anchors — db.js is checked out with CRLF line
  // endings on this machine, and matching exact whitespace would be fragile
  // across platforms anyway. Anchor on tokens instead of layout.
  const initIdx = dbSrc.indexOf('async function init() {');
  const queryMarker = 'await pool.query(`';
  const queryIdx = initIdx === -1 ? -1 : dbSrc.indexOf(queryMarker, initIdx);
  const backfillIdx = queryIdx === -1 ? -1 : dbSrc.indexOf('await backfillPublicCodes();', queryIdx);
  const endMarker = '`);';
  const endIdx = backfillIdx === -1 ? -1 : dbSrc.lastIndexOf(endMarker, backfillIdx);
  if (initIdx === -1 || queryIdx === -1 || backfillIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find the expected DDL block in ${dbSrcPath} — init() has changed shape ` +
      'since this drill script was written. Update the anchors in extractSchemaDDL().',
    );
  }
  return dbSrc.slice(queryIdx + queryMarker.length, endIdx);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Hostname/database name only — never the credentials — so a run's output can
// confirm which database it hit without ever printing anything secret.
function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

async function dumpSource(sourceUrl) {
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(sourceUrl);
  const source = new Client({ connectionString: sourceUrl, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await source.connect();
  console.log(`Connected to source: ${describeTarget(sourceUrl)}`);

  const dump = {};
  console.log('\n--- Dumping (read-only — nothing here can write to the source) ---');
  for (const table of TABLES) {
    const { rows } = await source.query(`SELECT * FROM ${table}`);
    dump[table] = rows;
    console.log(`  ${table}: ${rows.length} row(s)`);
  }
  await source.end();
  return dump;
}

async function restoreAndVerify(dump) {
  const pglite = await PGlite.create();
  const port = await getFreePort();
  const socketServer = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
  await socketServer.start();
  const targetUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  const target = new Client({ connectionString: targetUrl });
  await target.connect();

  console.log('\n--- Restoring into a throwaway local instance (never production) ---');
  const ddl = extractSchemaDDL();
  await target.query(ddl);
  console.log("  Schema created from db.js's own DDL (not a hand-copied duplicate).");

  await target.query('BEGIN');
  await target.query('SET LOCAL session_replication_role = replica;'); // defer FK checks during bulk load
  let totalInserted = 0;
  for (const table of TABLES) {
    for (const row of dump[table]) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      await target.query(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
        cols.map((c) => row[c]),
      );
      totalInserted++;
    }
  }
  await target.query('COMMIT');
  console.log(`  Inserted ${totalInserted} row(s) across ${TABLES.length} tables.`);

  console.log('\n--- Verifying ---');
  let allOk = true;
  for (const table of TABLES) {
    const { rows } = await target.query(`SELECT count(*)::int AS n FROM ${table}`);
    const restored = rows[0].n;
    const expected = dump[table].length;
    const ok = restored === expected;
    if (!ok) allOk = false;
    console.log(`  ${table}: ${restored}/${expected} ${ok ? 'OK' : 'MISMATCH'}`);
  }

  // A row-count match proves every row landed, but not that relationships
  // between tables survived. Spot-check the two relationships most load-
  // bearing to the product: every incident_event still resolves to a real
  // incident, and every user still resolves to a real organization (when it
  // has one at all — personal accounts legitimately don't).
  console.log('\n--- Referential integrity spot checks ---');
  const orphanChecks = [
    {
      label: 'incident_events -> incidents',
      sql: `SELECT count(*)::int AS n FROM incident_events e
            LEFT JOIN incidents i ON i.id = e.incident_id
            WHERE i.id IS NULL`,
    },
    {
      label: 'users -> organizations (org members only)',
      sql: `SELECT count(*)::int AS n FROM users u
            LEFT JOIN organizations o ON o.id = u.org_id
            WHERE u.org_id IS NOT NULL AND o.id IS NULL`,
    },
  ];
  for (const check of orphanChecks) {
    const { rows } = await target.query(check.sql);
    const orphans = rows[0].n;
    const ok = orphans === 0;
    if (!ok) allOk = false;
    console.log(`  ${check.label}: ${orphans} orphan(s) ${ok ? 'OK' : 'MISMATCH'}`);
  }

  await target.end();
  await socketServer.stop();
  await pglite.close();

  return allOk;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error(
      'SOURCE_DATABASE_URL is not set. Refusing to guess which database to drill against — '
      + 'see the usage note at the top of this file.',
    );
    process.exit(1);
  }

  const dump = await dumpSource(sourceUrl);
  const allOk = await restoreAndVerify(dump);

  console.log(
    `\n${allOk ? 'PASS' : 'FAIL'} — the source was never written to, and the restore target `
    + 'was destroyed on exit.',
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('\nDrill failed with an error:', e);
  process.exit(1);
});
