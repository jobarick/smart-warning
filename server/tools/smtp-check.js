#!/usr/bin/env node
// One controlled test email through the exact production mail code path
// (mail/providers.js smtpProvider, its timeouts and the Reply-To guard), so a
// mail-library upgrade can be proven against the real SMTP account BEFORE it
// is deployed.
//
// Usage (from server/, with SMTP_URL set in this shell only, never in a file):
//   PowerShell:  $env:SMTP_URL = '<value from Railway>'; node tools/smtp-check.js you@example.com
//   bash:        SMTP_URL='<value from Railway>' node tools/smtp-check.js you@example.com
//
// It never prints SMTP_URL, a password or a token. It sends exactly one
// message, to the address given, and reports what the server answered. An
// "accepted" answer only means the SMTP server took the message: check that it
// actually arrived in the inbox (and not in spam) before calling it delivered.
const { smtpProvider } = require('../mail/providers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main(argv = process.argv.slice(2), env = process.env, out = console) {
  const to = argv[0];
  if (!to || !EMAIL_RE.test(to)) {
    out.error('usage: node tools/smtp-check.js <recipient-email>');
    return 2;
  }
  const url = (env.SMTP_URL || '').trim();
  if (!url) {
    out.error('SMTP_URL is not set in this shell. Copy it from Railway into this terminal session only.');
    return 2;
  }
  const from = env.SMTP_FROM || 'Smart Warning <no-reply@smart-warning.app>';
  const stamp = new Date().toISOString();
  let provider;
  try {
    provider = smtpProvider(url, { from });
  } catch (e) {
    out.error(`could not set up SMTP: ${e.message}`);
    return 1;
  }
  out.log(`nodemailer ${require('nodemailer/package.json').version}; ${provider.describe()}`);
  out.log(`sending one test message to ${to} ...`);
  try {
    const res = await provider.send({
      to,
      replyTo: to,
      subject: `[Smart Warning] SMTP check ${stamp}`,
      body: [
        'This is a controlled test of the Smart Warning mail settings.',
        'No action is needed. It is not an emergency alert.',
        '',
        `Sent: ${stamp}`,
        `Library: nodemailer ${require('nodemailer/package.json').version}`,
      ].join('\n'),
    });
    out.log(`ACCEPTED by the SMTP server (message id ${res.id}).`);
    out.log(`Now confirm it arrived: search the inbox for "SMTP check ${stamp}".`);
    return 0;
  } catch (e) {
    out.error(`NOT SENT: ${e.code || 'error'}${e.responseCode ? ` (SMTP ${e.responseCode})` : ''}: ${String(e.message).replace(/\/\/[^@\s]*@/g, '//***@')}`);
    out.error(e.permanent ? 'The server refused it (permanent). Check the account, sender address and password on Railway.' : 'Temporary failure (network or server). Try again in a minute.');
    return 1;
  }
}

if (require.main === module) main().then((code) => process.exit(code));

module.exports = { main };
