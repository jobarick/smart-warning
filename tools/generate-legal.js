// Generate the hosted legal pages from the same source the app displays.
//
//   node tools/generate-legal.js
//
// Google Play requires a Privacy Policy URL on the listing, and a URL where
// somebody can request account deletion without installing the app. Those pages
// have to say the same thing as the copy inside the application — if the hosted
// terms and the in-app terms drift apart, the version a person actually agreed
// to becomes a question rather than a fact, which is exactly what a consent
// record exists to prevent.
//
// So client/src/lib/terms.ts is the single source and these files are derived.
// Do not edit docs/legal/*.md by hand; edit terms.ts and re-run this.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'client', 'src', 'lib', 'terms.ts');
const OUT_DIR = path.join(ROOT, 'docs', 'legal');
const TMP = path.join(ROOT, 'client', '.terms-bundle.cjs');

// terms.ts is TypeScript, so transpile it before requiring. esbuild is already
// present as a Vite dependency; nothing new is installed for this.
function loadTerms() {
  const isWindows = process.platform === 'win32';
  const esbuild = path.join(ROOT, 'client', 'node_modules', '.bin', isWindows ? 'esbuild.cmd' : 'esbuild');
  // Node 20+ refuses to spawn a .cmd without a shell (EINVAL), so Windows needs
  // shell:true — and with a shell, every path has to be quoted in case one of
  // them ever contains a space.
  const args = [SOURCE, '--bundle', '--platform=node', '--format=cjs', `--outfile=${TMP}`];
  execFileSync(
    isWindows ? `"${esbuild}"` : esbuild,
    isWindows ? args.map((a) => (a.startsWith('--') ? a.replace(/=(.+)$/, '="$1"') : `"${a}"`)) : args,
    { stdio: 'pipe', shell: isWindows },
  );
  try {
    return require(TMP);
  } finally {
    fs.rmSync(TMP, { force: true });
  }
}

function toMarkdown(title, sections, { version, effective }) {
  const lines = [
    `# ${title}`,
    '',
    `**Version ${version} — effective ${effective}**`,
    '',
    '<!-- Generated from client/src/lib/terms.ts by tools/generate-legal.js.',
    '     Do not edit by hand: this must stay identical to the text shown in the',
    '     application, which is what users actually accept. -->',
    '',
  ];
  for (const section of sections) {
    if (section.heading) lines.push(`## ${section.heading}`, '');
    for (const para of section.body) lines.push(para, '');
    if (section.bullets) {
      for (const b of section.bullets) lines.push(`- ${b}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function accountDeletionPage(terms) {
  return `# Account & Data Deletion — Smart Warning

**App:** Smart Warning (\`com.smartwarning.app\`)

This page explains how to delete a Smart Warning account and the data held with
it, as required by the Google Play Developer Program policies.

## Delete from inside the app

If you administer an organization:

1. Open Smart Warning and sign in as a supervisor.
2. Go to **About & legal**.
3. Choose **Delete organization and all data**.
4. Type the organization's name to confirm.

Deletion is immediate and cannot be undone.

## Request deletion without the app

If you do not administer an organization — for example you joined a team with a
code — contact us and we will action the request within **30 days**:

- Email: ${terms.SUPPORT_EMAIL}
- Phone: ${terms.SUPPORT_PHONE}

Include the name of the organization you belong to and the name or email you use
in the app, so we can identify the right records.

## What is deleted

Deleting an organization permanently removes:

- All supervisor accounts and their sign-in credentials
- Organization membership records
- Incident history, including alerts, roll-call answers and all-clears
- Location records captured during incidents
- Incident reports, including those submitted through a public link
- Feedback, queued email and device push registrations
- Records of terms acceptance

## What is kept, and why

Payment records — plan, amount, currency and a transaction reference — are
retained for accounting and tax purposes as required by law. They are detached
from the deleted organization and contain no location data and no personal
identifiers beyond the transaction itself.

Where any other record must be kept to meet a legal, safety or accounting
obligation, only the data covered by that obligation is retained, and only for
as long as the obligation lasts. We will tell you if that applies to your
request.

## Questions

${terms.SUPPORT_EMAIL} · ${terms.SUPPORT_PHONE}
`;
}

function main() {
  const terms = loadTerms();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const meta = { version: terms.TERMS_VERSION, effective: terms.TERMS_EFFECTIVE_DATE };

  const files = {
    'TERMS.md': toMarkdown('Smart Warning — Terms & Conditions', terms.TERMS_SECTIONS, meta),
    'PRIVACY_POLICY.md': toMarkdown('Smart Warning — Privacy Policy', terms.PRIVACY_SECTIONS, meta),
    'ACCOUNT_DELETION.md': accountDeletionPage(terms),
  };

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');
    console.log(`wrote docs/legal/${name} (${content.length} bytes)`);
  }
  console.log(`\nterms version ${meta.version}, effective ${meta.effective}`);
}

main();
