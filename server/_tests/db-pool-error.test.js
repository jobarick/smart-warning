// An error on an idle pooled connection must not take the server down.
//
// node-postgres reports it as an 'error' event on the Pool. db.js had no
// listener, so Node treated it as unhandled and the whole process exited:
// observed live on 2026-10-02 when the test database went away, and the same
// thing happens when a hosted pooler (Supabase) closes an idle connection.
// The relay, and every alert in flight, went with it.
//
// Run with: npm test   (from server/)
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const PG_PATH = require.resolve('pg', { paths: [path.join(__dirname, '..')] });
const DB_PATH = require.resolve(path.join(__dirname, '..', 'db.js'));

function loadDbWithFakePool() {
  const pools = [];
  class FakePool extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; pools.push(this); }
    async query() { return { rows: [{ '?column?': 1 }], rowCount: 1 }; }
  }
  const saved = { pg: require.cache[PG_PATH], db: require.cache[DB_PATH], url: process.env.DATABASE_URL };
  require.cache[PG_PATH] = { id: PG_PATH, filename: PG_PATH, loaded: true, exports: { Pool: FakePool } };
  delete require.cache[DB_PATH];
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/never-connected';
  const db = require(DB_PATH);
  const restore = () => {
    if (saved.pg) require.cache[PG_PATH] = saved.pg; else delete require.cache[PG_PATH];
    if (saved.db) require.cache[DB_PATH] = saved.db; else delete require.cache[DB_PATH];
    if (saved.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.url;
  };
  return { db, pool: pools[0], restore };
}

test('the pool has an error listener, so an idle-connection error is not fatal', (t) => {
  const { pool, restore } = loadDbWithFakePool();
  t.after(restore);
  assert.ok(pool, 'db.js should create a pool when DATABASE_URL is set');
  assert.ok(pool.listenerCount('error') >= 1, 'without a listener, Node exits the process on this event');
  // Emitting with no listener would throw synchronously here.
  assert.doesNotThrow(() => pool.emit('error', new Error('Connection terminated unexpectedly')));
});

test('a lost connection marks the database down until the next check succeeds', async (t) => {
  const { db, pool, restore } = loadDbWithFakePool();
  t.after(restore);

  await db.checkLiveness();
  assert.strictEqual(db.livenessStatus().ok, true);

  pool.emit('error', new Error('Connection terminated unexpectedly'));
  assert.strictEqual(db.livenessStatus().ok, false, '/api/health should not keep reporting a healthy database');

  // The pool replaces the broken connection on the next query.
  await db.checkLiveness();
  assert.strictEqual(db.livenessStatus().ok, true);
});
