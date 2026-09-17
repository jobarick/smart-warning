// Add one confirmed entry to the verified public-service directory.
//
// There is no submission form or admin screen for this yet — see
// directory_entries' own comment in db.js. This script is the actual "admin
// UI" for now: run it once per real, checked contact. It never accepts
// something merely reported; the person running it is vouching that they
// confirmed the number themselves.
//
// Usage (from server/, with DATABASE_URL set):
//   node scripts/add-directory-entry.js \
//     --category hospital \
//     --name "Muhimbili National Hospital" \
//     --phone "+255222151367" \
//     --lat -6.8039 --lng 39.2685 \
//     --address "United Nations Rd, Dar es Salaam" \
//     --source "called reception 2026-09-17"
//
// --category must be one of the kinds Nearby Help already searches for
// (hospital, police, fire, shelter, pharmacy) — a new category needs a
// matching OSM_QUERY entry in places.js first, or it will never appear
// alongside the community results it's meant to sit above.
const db = require('../db');

const CATEGORIES = new Set(['hospital', 'police', 'fire', 'shelter', 'pharmacy']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    out[key] = value;
    i++;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!CATEGORIES.has(args.category)) {
    console.error(`--category must be one of: ${[...CATEGORIES].join(', ')} (got ${args.category || '(none)'})`);
    process.exit(1);
  }
  if (!args.name) { console.error('--name is required'); process.exit(1); }
  const lat = Number(args.lat);
  const lng = Number(args.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('--lat and --lng are required and must be numbers');
    process.exit(1);
  }

  await db.init();
  const row = await db.createDirectoryEntry({
    category: args.category,
    name: args.name,
    phone: args.phone || null,
    lat, lng,
    address: args.address || null,
    source: args.source || null,
  });
  console.log('Added:', row);
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
