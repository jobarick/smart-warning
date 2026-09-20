// Deliberately rotate the Web Push VAPID keypair.
//
// Until this script existed, "rotate the VAPID keys" meant manually deleting
// the 'vapid' row from app_kv and hoping the next restart regenerated one —
// undocumented, easy to get wrong, and it left every existing browser
// subscription silently undeliverable forever (see
// db.deleteAllPushSubscriptions's own comment for why those can't just be
// pruned the normal way). This is the actual, complete operation:
//
//   1. Generate a fresh VAPID keypair and store it in app_kv, replacing
//      whatever was there.
//   2. Delete every stored push_subscriptions row — each one was registered
//      against the OLD public key and cannot be sent to under the new
//      private key. Every browser with push enabled gets a fresh
//      subscription automatically the next time it opens the app; nothing
//      server-side can do that for it sooner.
//
// This does NOT restart the server. server/push.js's init() reads the
// keypair once at boot, so the running process keeps signing with the OLD
// key until it restarts — deploy/restart right after running this, not on
// your own schedule, or there will be a window where the server is sending
// with a key that no longer matches what it just told every future
// subscriber to register against.
//
// When to actually run this: a suspected leak of the current private key,
// or a deliberate security rotation. Not a routine maintenance task — every
// run makes every currently-subscribed browser stop receiving push until it
// next opens the app, which for a life-safety product is a real, if brief,
// coverage gap. Schedule it, communicate it, and treat FCM (Android) as the
// channel that keeps working uninterrupted while this settles.
//
// Usage (from server/, with DATABASE_URL set):
//   node scripts/rotate-vapid-keys.js
//   node scripts/rotate-vapid-keys.js --yes   (skip the confirmation prompt)
const readline = require('node:readline');
const webpush = require('web-push');
const db = require('../db');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const skipConfirm = process.argv.includes('--yes');

  await db.init();
  if (!db.enabled()) {
    console.error('DATABASE_URL is not set — there is no stored VAPID keypair to rotate.');
    process.exit(1);
  }

  const existing = await db.getKv('vapid');
  if (!existing) {
    console.log('No VAPID keypair is currently stored — nothing to rotate. The next boot will generate one.');
    process.exit(0);
  }

  if (!skipConfirm) {
    const answer = await ask(
      'This will generate a new VAPID keypair and permanently delete every stored Web Push\n'
      + 'subscription (Android/FCM subscribers are unaffected). Every browser with push enabled\n'
      + 'will stop receiving push until it next opens the app. Restart the server immediately\n'
      + 'after this completes. Type "rotate" to continue: ',
    );
    if (answer.trim() !== 'rotate') {
      console.log('Not confirmed — nothing was changed.');
      process.exit(0);
    }
  }

  const keys = webpush.generateVAPIDKeys();
  await db.setKv('vapid', JSON.stringify(keys));
  const cleared = await db.deleteAllPushSubscriptions();

  console.log(`[vapid] new keypair stored (public key: ${keys.publicKey})`);
  console.log(`[vapid] cleared ${cleared} stored Web Push subscription(s)`);
  console.log('[vapid] restart the server now so it picks up the new key.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[vapid] rotation failed:', e.message);
    process.exit(1);
  });
