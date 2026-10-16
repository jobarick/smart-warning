#!/usr/bin/env node
// Writes docs/DIRECTORY_COVERAGE.md from server/data/tz-facilities.json:
// counts by region, kind and district, and every gap, so nobody mistakes a
// map of Tanzania for complete national coverage.
//   node server/tools/directory-build/coverage.js > docs/DIRECTORY_COVERAGE.md
'use strict';
const directory = require('../../directory');

const ZANZIBAR = new Set(['Kaskazini Pemba', 'Kusini Pemba', 'Kaskazini Unguja', 'Kusini Unguja', 'Mjini Magharibi']);
const KINDS = ['hospital', 'police', 'fire', 'pharmacy', 'utility', 'anticorruption'];
const LABEL = { hospital: 'Health', police: 'Police', fire: 'Fire', pharmacy: 'Pharmacy', utility: 'TANESCO', anticorruption: 'TAKUKURU' };

const st = directory.load();
const regions = directory.areas();
const n = (c, k) => c[k] || 0;
const lines = [];
lines.push('# Nationwide emergency facilities: coverage report');
lines.push('');
lines.push(`Generated from \`server/data/tz-facilities.json\` (built ${st.generated}, ${st.records} records). Source: OpenStreetMap via HOT exports (snapshot 2026-10-07). **Every record is unverified open data.** Counts show what is mapped, not what exists: a zero means "not in the map data", never "no such service".`);
lines.push('');
const totals = {}; for (const r of regions) for (const k of KINDS) totals[k] = (totals[k] || 0) + n(r.counts, k);
lines.push('## National totals');
lines.push('');
lines.push(`| ${KINDS.map((k) => LABEL[k]).join(' | ')} |`);
lines.push(`|${KINDS.map(() => '---').join('|')}|`);
lines.push(`| ${KINDS.map((k) => totals[k]).join(' | ')} |`);
lines.push('');
lines.push('## By region');
lines.push('');
lines.push(`| Region | Part | ${KINDS.map((k) => LABEL[k]).join(' | ')} | Districts with no health facility | Districts with no police |`);
lines.push(`|---|---|${KINDS.map(() => '---:').join('|')}|---:|---:|`);
for (const r of regions) {
  const noHealth = r.districts.filter((d) => !n(d.counts, 'hospital')).length;
  const noPolice = r.districts.filter((d) => !n(d.counts, 'police')).length;
  lines.push(`| ${r.name} | ${ZANZIBAR.has(r.name) ? 'Zanzibar' : 'Mainland'} | ${KINDS.map((k) => n(r.counts, k)).join(' | ')} | ${noHealth} of ${r.districts.length} | ${noPolice} of ${r.districts.length} |`);
}
lines.push('');
const gapsHealth = regions.filter((r) => !n(r.counts, 'hospital')).map((r) => r.name);
const gapsPolice = regions.filter((r) => !n(r.counts, 'police')).map((r) => r.name);
const gapsFire = regions.filter((r) => !n(r.counts, 'fire')).map((r) => r.name);
lines.push('## Gaps');
lines.push('');
lines.push(`- Regions with **no mapped health facility**: ${gapsHealth.join(', ') || 'none'}`);
lines.push(`- Regions with **no mapped police**: ${gapsPolice.join(', ') || 'none'}`);
lines.push(`- Regions with **no mapped fire station** (${gapsFire.length} of ${regions.length}): ${gapsFire.join(', ') || 'none'}`);
lines.push('- Categories with **no records at all**: disaster management offices, coast guard / lake rescue stations (beyond 15 marine police), ambulance bases, child protection / social welfare offices, human trafficking response offices, water utility offices. The HOT exports keep only `amenity`, `shop`, `tourism` and `man_made` tags, so `office=*`, `emergency=*` and phone numbers are not in the source at all.');
lines.push('- Only 1 TAKUKURU office and 7 TANESCO offices are tagged in a way this import can recognise.');
const allDistricts = regions.flatMap((r) => r.districts.map((d) => ({ ...d, region: r.name })));
const emptyDistricts = allDistricts.filter((d) => !n(d.counts, 'hospital') && !n(d.counts, 'police'));
lines.push(`- Districts with neither a mapped health facility nor police (${emptyDistricts.length} of ${allDistricts.length}): ${emptyDistricts.map((d) => `${d.name} (${d.region})`).join(', ') || 'none'}`);
lines.push('');
lines.push('## What this means in the app');
lines.push('');
lines.push('Where nothing is mapped, the app says so and points to the national number. It never widens the search silently to show something far away as if it were near.');
lines.push('');
process.stdout.write(lines.join('\n') + '\n');
