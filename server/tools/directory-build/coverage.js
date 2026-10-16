#!/usr/bin/env node
// Writes docs/DIRECTORY_COVERAGE.md from server/data/tz-facilities.json:
// counts by region, kind and district, and every gap, so nobody mistakes a
// map of Tanzania for complete national coverage.
//   node server/tools/directory-build/coverage.js > docs/DIRECTORY_COVERAGE.md
'use strict';
const directory = require('../../directory');

const ZANZIBAR = new Set(['Kaskazini Pemba', 'Kusini Pemba', 'Kaskazini Unguja', 'Kusini Unguja', 'Mjini Magharibi']);
const KINDS = ['hospital', 'police', 'fire', 'security', 'pharmacy', 'utility', 'anticorruption'];
const LABEL = { hospital: 'Health', police: 'Police', fire: 'Fire', security: 'Private security', pharmacy: 'Pharmacy', utility: 'TANESCO', anticorruption: 'TAKUKURU' };

const st = directory.load();
const regions = directory.areas();
const raw = require('../../data/tz-facilities.json');
const fi = Object.fromEntries(raw.fields.map((f, i) => [f, i]));
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
// Verification status of what is served.
const status = {};
for (const r of raw.records) status[r[fi.status] || 'open-data'] = (status[r[fi.status] || 'open-data'] || 0) + 1;
lines.push('## Verification status');
lines.push('');
lines.push('| Status | Count | Meaning |');
lines.push('|---|---:|---|');
lines.push(`| Officially verified | 0 | Published or confirmed by the responsible authority. None yet. |`);
lines.push(`| Provider-published | ${(raw.providers || []).length} | Private services from the provider's own website (listed, not pinned). |`);
lines.push(`| Open data | ${status['open-data'] || 0} | From OpenStreetMap, not independently confirmed. |`);
lines.push(`| Needs review | ${status['needs-review'] || 0} | Evidence incomplete or conflicting; shown with a warning and the reason. |`);
lines.push(`| Excluded | ${(raw.excluded || []).length} | Shown to be wrong; kept out of the app, listed below with the reason. |`);
lines.push('');
lines.push(`Data freshness: OpenStreetMap exports snapshot 2026-10-07; live OpenStreetMap queries 2026-10-16; boundaries 2018-10-19. Hand review: 2026-10-16.`);
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
lines.push(`- Regions with **no mapped health facility**: ${gapsHealth.join(', ') || 'none (Kaskazini Pemba now has health facilities, all needing review)'}`);
lines.push(`- Regions with **no mapped police**: ${gapsPolice.join(', ') || 'none'}`);
lines.push(`- Regions with **no mapped fire station** (${gapsFire.length} of ${regions.length}): ${gapsFire.join(', ') || 'none'}`);
lines.push('- Categories with **no records at all**: disaster management offices, coast guard / lake rescue stations (beyond 15 marine police), ambulance bases (public or private), child protection / social welfare offices, human trafficking response offices, water utility offices. The HOT exports keep only `amenity`, `shop`, `tourism` and `man_made` tags, so `office=*`, `emergency=*` and phone numbers are not in the source at all.');
lines.push('- Only 1 TAKUKURU office and 7 TANESCO offices are tagged in a way this import can recognise.');
lines.push('- Private sector: only 13 private security companies (Dar es Salaam and Mwanza) and no private ambulance services are mapped in OpenStreetMap. 472 health facilities are tagged private, 437 government; most (about 86%) do not say who runs them.');
const allDistricts = regions.flatMap((r) => r.districts.map((d) => ({ ...d, region: r.name })));
const emptyDistricts = allDistricts.filter((d) => !n(d.counts, 'hospital') && !n(d.counts, 'police'));
lines.push(`- Districts with neither a mapped health facility nor police (${emptyDistricts.length} of ${allDistricts.length}): ${emptyDistricts.map((d) => `${d.name} (${d.region})`).join(', ') || 'none'}`);
lines.push('');
const fireGaps = regions.filter((r) => !n(r.counts, 'fire'));
lines.push('## Excluded records (with reasons)');
lines.push('');
for (const e of raw.excluded || []) lines.push(`- ${e.name} (${e.id}, ${raw.regions[e.region] || e.region}): ${e.reason}`);
lines.push('');
lines.push('## Reviewed and not added');
lines.push('');
for (const e of raw.notIncluded || []) lines.push(`- ${e.name} (${e.id}): ${e.reason}`);
lines.push('');
lines.push('## Known to exist, no reliable map location yet');
lines.push('');
for (const k of raw.knownUnmapped || []) lines.push(`- ${k.name} (${raw.regions[k.region] || k.region}): ${k.reason} Evidence: ${k.evidence.join(', ')}`);
lines.push('');
lines.push('## Private providers');
lines.push('');
lines.push('Listed in the app (provider-published, from their own websites):');
for (const pv of raw.providers || []) lines.push(`- **${pv.name}** (${pv.kind}): ${pv.service}. ${pv.coverage}. Phones: ${pv.phones.map((x) => x.display).join(', ')}. Source: ${pv.source.url}, checked ${pv.source.checked}.`);
lines.push('');
lines.push('Candidates found but not confirmed (not in the app):');
for (const c of raw.candidatesNotConfirmed || []) lines.push(`- ${c.name} (${c.kind}): ${c.note}`);
lines.push('');
lines.push('## Priority for field verification or direct contact');
lines.push('');
lines.push('1. **Kaskazini Pemba**: confirm the health facilities mapped with an unresolved type (all "needs review"), find a location for Wete District Hospital, and find any police and fire station (none mapped).');
lines.push(`2. **Fire and rescue in ${fireGaps.length} regions with none mapped**: ${fireGaps.map((r) => r.name).join(', ')}. Ask the Fire and Rescue Force for its regional station list with addresses.`);
lines.push('3. **Needs-review police**: "UNGA LTD" (Arusha) and every record flagged in the app.');
lines.push('4. **Private ambulance and security**: contact City Ambulance, Knight Support, G4S and Telesecurity to confirm offices, numbers and coverage before listing.');
lines.push('5. **Emergency numbers**: written confirmation from TCRA and each agency (see the numbers checklist pack).');
lines.push('');
lines.push('## What this means in the app');
lines.push('');
lines.push('Where nothing is mapped, the app says so and points to the national number. It never widens the search silently to show something far away as if it were near.');
lines.push('');
process.stdout.write(lines.join('\n') + '\n');
