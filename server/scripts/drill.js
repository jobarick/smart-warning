// Mark an organisation as a rehearsal drill (or end the drill).
//
// While an organisation is a drill, its SOS alerts reach its own members as
// usual, but Nearby Help offers them only to responders tied to this drill
// (scripts/verify-responder.js --drill-org), never to a real responder. Those
// test responders, in turn, are never offered a real SOS and never appear on
// anyone's live map. See docs/PILOT_PLAN.md section 9.
//
// Usage (from server/, with DATABASE_URL set):
//   node scripts/drill.js --org <join code> --status
//   node scripts/drill.js --org <join code> --on
//   node scripts/drill.js --org <join code> --off
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
  if (!args.org || args.org === true) { console.error('--org <join code> is required'); process.exit(1); }
  const modes = ['on', 'off', 'status'].filter((m) => args[m] === true);
  if (modes.length !== 1) { console.error('say exactly one of --on, --off or --status'); process.exit(1); }

  await db.init();
  const org = await db.getOrgByCode(String(args.org));
  if (!org) { console.error(`no organisation with join code ${args.org}`); process.exit(1); }

  let isDrill = org.is_drill === true;
  if (modes[0] !== 'status') {
    const row = await db.setOrgDrill({ orgId: org.id, on: modes[0] === 'on' });
    isDrill = row.is_drill === true;
  }
  const counts = await db.countDrillResponders(org.id);
  console.log({ organisation: org.name, drill: isDrill, testResponders: counts.tied, verifiedTestResponders: counts.verified });
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
