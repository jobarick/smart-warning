// Prove the ClickPesa integration works, without charging anybody.
//
//   node server/tools/clickpesa-check.js
//   node server/tools/clickpesa-check.js 0713455454 80000
//
// Runs three checks in order, because each one only makes sense if the
// previous passed:
//
//   1. Are the credentials present?      (reads env, never prints a secret)
//   2. Do they authenticate?             (POST /generate-token)
//   3. Can this number actually be charged, and what would it cost?
//                                        (POST /preview-ussd-push-request)
//
// Step 3 is the useful one and is deliberately the furthest this tool goes.
// `preview` asks the gateway which wallets are available for an amount and a
// number and what each would charge — it does NOT send a USSD prompt and does
// NOT move money. There is intentionally no option here to raise a real
// charge: the first genuine payment should be made by a person, through the
// app, watching their own phone.
//
// Run it locally with the values you are about to put on Render, or on Render
// itself via its shell, to tell "credentials are wrong" apart from "the app is
// wrong" in one step.
const path = require('node:path');

const REQUIRED = ['CLICKPESA_CLIENT_ID', 'CLICKPESA_API_KEY'];
const OPTIONAL = ['CLICKPESA_CHECKSUM_KEY', 'CLICKPESA_BASE_URL'];

const phoneArg = process.argv[2] || '0713455454';
const amountArg = process.argv[3] || '8000';

// Never print a credential. Length alone is enough to spot the usual mistakes
// — a value that was not pasted, or one that arrived with quotes or whitespace
// still attached.
function describe(name) {
  const raw = process.env[name];
  if (!raw) return 'not set';
  const trimmed = raw.trim();
  const notes = [];
  if (trimmed !== raw) notes.push('HAS SURROUNDING WHITESPACE');
  if (/^["'].*["']$/.test(trimmed)) notes.push('LOOKS QUOTED — paste the value without quotes');
  return `set, ${trimmed.length} chars${notes.length ? ' — ' + notes.join('; ') : ''}`;
}

function line(ok, text) {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${text}`);
}

async function main() {
  console.log('\nClickPesa integration check');
  console.log('='.repeat(60));

  // --- 1. Environment ------------------------------------------------------
  console.log('\n1. Credentials');
  let missing = false;
  for (const name of REQUIRED) {
    const present = Boolean((process.env[name] || '').trim());
    if (!present) missing = true;
    line(present, `${name.padEnd(24)} ${describe(name)}`);
  }
  for (const name of OPTIONAL) {
    console.log(`       ${name.padEnd(24)} ${describe(name)}`);
  }

  if (missing) {
    console.log(`
Set them and run again. Locally:

  $env:CLICKPESA_CLIENT_ID="..."; $env:CLICKPESA_API_KEY="..."; node server/tools/clickpesa-check.js

On Render: Dashboard > smart-warning-relay > Environment > Add Environment
Variable, then let it redeploy. See docs/PAYMENTS_SETUP.md.
`);
    process.exitCode = 1;
    return;
  }

  const clickpesa = require(path.join(__dirname, '..', 'payments', 'clickpesa.js'));
  const phone = require(path.join(__dirname, '..', 'payments', 'phone.js'));

  // --- 2. Authentication ---------------------------------------------------
  console.log('\n2. Authentication');
  try {
    await clickpesa.getToken({ force: true });
    line(true, 'generate-token accepted the credentials');
  } catch (e) {
    line(false, `generate-token failed: ${e.message}`);
    // A transport fault and a rejection are different problems with different
    // fixes, and a diagnostic that blames the credentials for a DNS failure
    // sends you looking in the wrong place.
    if (e.status === 0 || e.status === undefined) {
      console.log(`
  The gateway could not be reached at all — this is a network problem, not a
  credential one. Check outbound HTTPS to api.clickpesa.com from wherever you
  are running this, then try again. A first attempt occasionally fails on a
  cold DNS cache and succeeds immediately after.
`);
    } else if (e.status === 403) {
      console.log(`
  403 — the gateway answered and rejected the credentials. The client id and
  api key do not match, the key has expired, or the application is not
  authorised for the Collection API. "Invalid client details" is the usual
  wording for a mismatched pair.
`);
    } else if (e.status === 401) {
      console.log(`
  401 — one of the two headers did not arrive. Check for quotes or trailing
  whitespace around the values.
`);
    }
    process.exitCode = 1;
    return;
  }

  // --- 3. What can actually be collected -----------------------------------
  console.log('\n3. Collection preview (no charge, no USSD prompt)');

  const msisdn = phone.normalize(phoneArg);
  if (!msisdn) {
    line(false, `${phoneArg} is not a valid Tanzanian mobile number`);
    process.exitCode = 1;
    return;
  }
  const operator = phone.operatorOf(msisdn);
  line(true, `${phone.format(msisdn)} → ${phone.operatorMeta(operator)?.label ?? operator}`);

  if (!phone.isCollectable(msisdn)) {
    line(false, 'that network has no mobile money product — collection is not possible');
    process.exitCode = 1;
    return;
  }

  try {
    const out = await clickpesa.preview({
      amount: amountArg,
      currency: 'TZS',
      orderReference: clickpesa.makeOrderReference('SWCHK'),
      phoneNumber: msisdn,
    });

    if (out.activeMethods.length === 0) {
      line(false, 'the gateway reported no active collection methods for this amount');
      console.log('      Usually means the Collection API is not enabled on the application yet.');
      process.exitCode = 1;
      return;
    }

    line(true, `gateway returned ${out.activeMethods.length} method(s) for TZS ${amountArg}`);
    for (const m of out.activeMethods) {
      const available = String(m.status).toUpperCase() === 'AVAILABLE';
      const fee = m.fee != null ? `fee ${m.fee}` : '';
      console.log(`         ${available ? '✓' : '✗'} ${String(m.name).padEnd(14)} ${m.status}  ${fee}${m.message ? ' — ' + m.message : ''}`);
    }

    const channel = phone.operatorMeta(operator)?.channel;
    const match = out.activeMethods.find((m) => String(m.name).toUpperCase() === channel);
    if (match && String(match.status).toUpperCase() === 'AVAILABLE') {
      line(true, `${phone.operatorMeta(operator).label} is available — this number can be charged`);
    } else {
      line(false, `${phone.operatorMeta(operator)?.label ?? operator} is not currently available`);
      console.log('      The account works; that particular wallet is not enabled or is down.');
    }
  } catch (e) {
    line(false, `preview failed: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`
${'='.repeat(60)}
Credentials are good and collection is live.

Remaining, in the ClickPesa dashboard:
  • Register the webhook:
    https://smart-warning-relay.onrender.com/api/payments/mobile-money/webhook
  • Optionally set a checksum key and add it as CLICKPESA_CHECKSUM_KEY.
    Not load-bearing — every callback is verified against the gateway before
    anything is provisioned — but it lets a forged callback be rejected on
    arrival rather than merely being useless.

Then the first real payment: open the app as a supervisor, Plans, pick one,
pay with your own number, and approve the prompt on your handset.
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
