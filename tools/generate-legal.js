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
// Written into the client's public directory so the pages ship with the built
// app and are served, unauthenticated, by every host it is deployed to. Play
// needs a URL it can open without installing anything; a markdown file in a
// private repository is not one.
const WEB_DIR = path.join(ROOT, 'client', 'public', 'legal');
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

1. Open Smart Warning and sign in as a Safety Coordinator.
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

- All Safety Coordinator accounts and their sign-in credentials
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

// --- Hosted HTML -----------------------------------------------------------

const escape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One stylesheet, inlined. These pages are opened by a Play reviewer, by
// somebody on a slow connection who wants to know what happens to their
// location, and by a person trying to delete an account — none of whom should
// wait on a font or a stylesheet from somewhere else, and all of whom may be
// reading on a phone.
const STYLE = `
  :root { color-scheme: dark light; --bg:#080808; --panel:#101012; --text:#f2f2f4; --muted:#a0a0a8; --line:#232327; --accent:#ff453a; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#fbfbfc; --panel:#fff; --text:#131316; --muted:#5a5a63; --line:#e4e4e8; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 20px 72px; background:var(--bg); color:var(--text);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 1.6rem; line-height:1.25; margin:0 0 6px; }
  h2 { font-size: 1.05rem; margin:34px 0 8px; }
  p, li { color: var(--text); }
  .meta { color: var(--muted); font-size:.85rem; margin:0 0 8px; }
  .by { color: var(--muted); font-size:.9rem; margin:0 0 28px; padding-bottom:20px; border-bottom:1px solid var(--line); }
  .notice { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent);
            border-radius:10px; padding:14px 16px; margin:0 0 28px; font-size:.95rem; }
  ul { padding-left: 1.15rem; }
  li { margin: 4px 0; }
  nav { margin-top:44px; padding-top:20px; border-top:1px solid var(--line); font-size:.9rem; }
  nav a { color: var(--muted); margin-right:16px; }
  a { color: var(--accent); }
  footer { margin-top:28px; color:var(--muted); font-size:.82rem; }
`;

function page({ title, provider, version, effective, bodyHtml, showEmergencyNotice = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Smart Warning</title>
<meta name="robots" content="index,follow">
<!-- Generated from client/src/lib/terms.ts by tools/generate-legal.js.
     Do not edit by hand: this must stay identical to the text shown inside the
     application, which is what people actually accept. -->
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escape(title)}</h1>
${version ? `<p class="meta">Version ${escape(version)} — effective ${escape(effective)}</p>` : ''}
<p class="by">Smart Warning is provided by <strong>${escape(provider)}</strong>.</p>
${showEmergencyNotice ? `<p class="notice"><strong>If you are in immediate danger, call your local emergency services directly.</strong> Smart Warning assists with emergency communication — it is not an emergency service and does not replace one.</p>` : ''}
${bodyHtml}
<nav>
  <a href="/legal/">All documents</a>
  <a href="/legal/privacy.html">Privacy Policy</a>
  <a href="/legal/terms.html">Terms</a>
  <a href="/legal/delete.html">Delete your data</a>
  <a href="/">Open the app</a>
</nav>
<footer>© ${new Date().getFullYear()} ${escape(provider)}. Smart Warning holds no partnership with, or authorization from, any emergency service or government authority.</footer>
</main>
</body>
</html>
`;
}

function sectionsToHtml(sections) {
  const out = [];
  for (const section of sections) {
    if (section.heading) out.push(`<h2>${escape(section.heading)}</h2>`);
    for (const para of section.body) out.push(`<p>${escape(para)}</p>`);
    if (section.bullets) {
      out.push('<ul>');
      for (const b of section.bullets) out.push(`<li>${escape(b)}</li>`);
      out.push('</ul>');
    }
  }
  return out.join('\n');
}

// The deletion page is written as prose rather than derived from sections, so
// it renders from the same markdown the docs/ copy uses.
function markdownishToHtml(md) {
  const out = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    if (!line) { closeList(); continue; }
    if (line.startsWith('# ')) { closeList(); continue; } // the <h1> is the page title
    if (line.startsWith('## ')) { closeList(); out.push(`<h2>${escape(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

// Only the two markers the deletion page actually uses.
function inline(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function indexPage(provider, meta) {
  return page({
    title: 'Smart Warning — legal & data',
    provider,
    version: meta.version,
    effective: meta.effective,
    showEmergencyNotice: false,
    bodyHtml: `
<p>The documents that govern the Smart Warning application, and how to remove your data from it.</p>
<ul>
  <li><a href="/legal/privacy.html">Privacy Policy</a> — what is collected, when location is and is not recorded, who can see it.</li>
  <li><a href="/legal/terms.html">Terms &amp; Conditions</a> — what the service does and what it does not guarantee.</li>
  <li><a href="/legal/delete.html">Account &amp; data deletion</a> — how to delete an account, in the app or by request.</li>
</ul>
<p>These pages are generated from the same source as the text shown inside the application, so the hosted wording and the wording people accept cannot drift apart.</p>`,
  });
}

function main() {
  const terms = loadTerms();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(WEB_DIR, { recursive: true });

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

  const provider = terms.PROVIDER;
  const web = {
    'index.html': indexPage(provider, meta),
    'privacy.html': page({
      title: 'Privacy Policy', provider, ...meta,
      bodyHtml: sectionsToHtml(terms.PRIVACY_SECTIONS),
    }),
    'terms.html': page({
      title: 'Terms & Conditions', provider, ...meta,
      bodyHtml: sectionsToHtml(terms.TERMS_SECTIONS),
    }),
    'delete.html': page({
      title: 'Account & data deletion', provider, ...meta,
      showEmergencyNotice: false,
      bodyHtml: markdownishToHtml(files['ACCOUNT_DELETION.md']),
    }),
  };

  for (const [name, content] of Object.entries(web)) {
    fs.writeFileSync(path.join(WEB_DIR, name), content, 'utf8');
    console.log(`wrote client/public/legal/${name} (${content.length} bytes)`);
  }

  console.log(`\nterms version ${meta.version}, effective ${meta.effective}`);
  console.log('hosted at <origin>/legal/privacy.html, /legal/terms.html, /legal/delete.html');
}

main();
