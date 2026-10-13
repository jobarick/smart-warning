// Mark a Nearby Help responder as verified (or revoke it).
//
// Verification is a person vouching for another person: run this only after
// actually checking who they are (ID seen, reference called, training record).
// A verified responder gets the badge, appears on other people's live map, and
// is sent to the responder view when they sign in. Nothing in the app can set
// this on its own, and the responder cannot set it for themselves.
//
// Usage (from server/, with DATABASE_URL set):
//   node scripts/verify-responder.js --email asha@example.com --by "ID checked by J. Mushi 2026-10-13"
//   node scripts/verify-responder.js --email asha@example.com --revoke
const db = require('../db');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) { console.error('--email is required'); process.exit(1); }
  if (!args.revoke && !args.by) { console.error('--by is required: say who checked them and how'); process.exit(1); }

  await db.init();
  const user = await db.getUserByEmail(String(args.email));
  if (!user) { console.error(`no account with email ${args.email}`); process.exit(1); }
  const row = await db.verifyResponder({ userId: user.id, verifiedBy: args.by || null, revoke: args.revoke === true });
  if (!row) {
    console.error('that account has never opted in to Nearby Help, so there is nothing to verify yet');
    process.exit(1);
  }
  console.log(args.revoke ? 'Revoked:' : 'Verified:', { user: user.email, verifiedAt: row.verified_at, verifiedBy: row.verified_by });
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
