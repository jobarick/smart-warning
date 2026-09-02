#!/usr/bin/env node
//
// Test an SMTP_URL before putting it anywhere near Render.
//
//   node tools/smtp-check.js "smtps://user:pass@smtp.example.com:465"
//   node tools/smtp-check.js                     # reads SMTP_URL from the env
//   node tools/smtp-check.js --probe "smtp://user:pass@smtp.example.com"
//
// `--probe` tries the four scheme/port pairs that actually exist and reports
// which one connects, which is the answer to "is it 465 or 587, smtp or smtps"
// without a deploy cycle per guess.
//
// Why this exists: a wrong SMTP_URL on this project produced ESOCKET at the
// CONN phase in production, and the round trip to find that out was — change
// the variable, wait for Render to restart, wait for the drain timer, read
// /api/health. Minutes per attempt, for a question answerable in seconds from
// a laptop.
//
// It deliberately imports the SAME smtpOptions() the server uses, so this is a
// test of the real code path and not of a second implementation that might
// disagree with it. It only ever connects and authenticates — verify() does not
// send a message.
//
// The password is never printed, in any mode.

const path = require('node:path');
const { smtpOptions } = require(path.join(__dirname, '..', 'server', 'mail', 'providers'));

/** What each failure actually means, in the order you should check them. */
const EXPLAIN = {
  ESOCKET:
    'The socket failed before SMTP began — almost always a TLS/port mismatch.\n'
    + '     smtps:// is implicit TLS and belongs on 465.\n'
    + '     smtp://  is plaintext + STARTTLS and belongs on 587.\n'
    + '     Swap whichever half is wrong and try again (--probe does this for you).',
  ECONNECTION:
    'Could not open a connection at all — wrong host, or the port is blocked.\n'
    + '     Render blocks outbound port 25 entirely; use 465 or 587.',
  ETIMEDOUT:
    'Connected (or tried to) and then silence. A firewall dropping the packets,\n'
    + '     or the wrong port on a host that simply never answers.',
  EDNS: 'The hostname does not resolve. Check the spelling of the host.',
  EAUTH:
    'The connection is FINE — the credentials were rejected. This is progress.\n'
    + '     For Gmail this means you need an App Password, not the account password.\n'
    + '     Also check the password is percent-encoded if it contains @ / : # or ?',
  EENVELOPE:
    'Connected and authenticated, but the server refused the sender address.\n'
    + '     MAIL_FROM has to be an address this account is allowed to send as.',
};

function redact(url) {
  return String(url).replace(/\/\/([^:/@]*)(:[^@]*)?@/, (_, user) => `//${user}:***@`);
}

/** One attempt. Resolves to a plain result rather than throwing. */
async function check(url, { quiet = false } = {}) {
  let nodemailer;
  try {
    nodemailer = require(path.join(__dirname, '..', 'server', 'node_modules', 'nodemailer'));
  } catch {
    try {
      nodemailer = require('nodemailer');
    } catch {
      return { ok: false, code: 'ENOMODULE', message: 'nodemailer not installed — run npm ci in server/' };
    }
  }

  let options;
  try {
    options = smtpOptions(url);
  } catch (e) {
    return { ok: false, code: 'EBADURL', message: `not a usable URL: ${e.message}` };
  }

  if (!quiet) {
    console.log(`  host    ${options.host}`);
    console.log(`  port    ${options.port}`);
    console.log(`  secure  ${options.secure}   ${options.secure ? '(implicit TLS)' : '(plaintext + STARTTLS)'}`);
    console.log(`  auth    ${options.auth ? `${options.auth.user} / ***` : 'none'}`);
    console.log(`  timeout ${options.connectionTimeout}ms connect · ${options.socketTimeout}ms socket`);
    console.log('');
  }

  const transport = nodemailer.createTransport(options);
  try {
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || null, command: e.command || null, message: e.message };
  } finally {
    transport.close?.();
  }
}

/** The four combinations worth trying, in order of likelihood. */
function variants(url) {
  const u = new URL(url);
  const rest = `${u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''}${u.hostname}`;
  const q = u.search || '';
  return [
    { label: 'smtps + 465 (implicit TLS)', url: `smtps://${rest}:465${q}` },
    { label: 'smtp  + 587 (STARTTLS)', url: `smtp://${rest}:587${q}` },
    { label: 'smtps + 587', url: `smtps://${rest}:587${q}` },
    { label: 'smtp  + 465', url: `smtp://${rest}:465${q}` },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const probe = args.includes('--probe');
  const url = args.find((a) => !a.startsWith('--')) || process.env.SMTP_URL;

  if (!url) {
    console.error('Usage: node tools/smtp-check.js [--probe] "smtps://user:pass@host:465"');
    console.error('       (or set SMTP_URL in the environment)');
    process.exit(2);
  }

  console.log(`\nSMTP check — ${redact(url)}\n`);

  if (probe) {
    console.log('Trying every scheme/port pair. Looking for one that connects.\n');
    const results = [];
    for (const v of variants(url)) {
      process.stdout.write(`  ${v.label.padEnd(28)} … `);
      // eslint-disable-next-line no-await-in-loop
      const r = await check(v.url, { quiet: true });
      // EAUTH means the transport worked and only the credentials are wrong —
      // for the purpose of "which port speaks to this host", that is a success.
      const reachable = r.ok || r.code === 'EAUTH';
      console.log(r.ok ? 'OK' : `${r.code || 'failed'}${reachable ? '  (connection fine — credentials rejected)' : ''}`);
      results.push({ ...v, ...r, reachable });
    }
    const winner = results.find((r) => r.ok) || results.find((r) => r.reachable);
    console.log('');
    if (winner) {
      console.log(`Use this one:\n\n  SMTP_URL=${redact(winner.url)}\n`);
      if (!winner.ok) console.log('…once the credentials are right. See EAUTH below.\n');
      if (EXPLAIN[winner.code]) console.log(`${winner.code}: ${EXPLAIN[winner.code]}\n`);
    } else {
      console.log('None of the four connected. That points at the host or the network,\n'
        + 'not at the scheme/port pair — check the hostname first.\n');
    }
    process.exit(winner?.ok ? 0 : 1);
  }

  const r = await check(url);
  if (r.ok) {
    console.log('OK — connected and authenticated. This URL will work.\n');
    console.log('Set it on Render, and the queued mail drains by itself within a minute:');
    console.log('  curl -s https://smart-warning-relay-6lf3.onrender.com/api/health\n');
    process.exit(0);
  }

  console.log(`FAILED  ${r.code || 'unknown'}${r.command ? ` at ${r.command}` : ''}`);
  console.log(`  ${r.message}\n`);
  if (EXPLAIN[r.code]) console.log(`  ${EXPLAIN[r.code]}\n`);
  console.log('  Try:  node tools/smtp-check.js --probe "<your url>"\n');
  process.exit(1);
}

main().catch((e) => {
  console.error(`smtp-check failed unexpectedly: ${e.message}`);
  process.exit(3);
});
