# Payments setup

Smart Warning collects subscription payments two ways:

| Market | Method | Provider | Currency |
|---|---|---|---|
| East Africa | Mobile money USSD push | ClickPesa | TZS |
| International | Card (hosted checkout) | Stripe | USD |

Both are optional. With neither configured the app still runs, every
organization sits on the free tier, and the plan catalogue is still served —
there is simply no way to start a checkout.

> **Emergency alerting is never affected by anything in this document.**
> SOS, all-clear, roll call, live location and the relay itself do not consult
> subscription state at all. See [`server/billing/entitlements.js`](../server/billing/entitlements.js)
> and the end-to-end proof in [`server/_tests/safety.test.js`](../server/_tests/safety.test.js).

---

## 1. Plans

Prices live in one place: [`server/billing/plans.js`](../server/billing/plans.js).

| Plan | TZS / month | USD / month | Seats |
|---|---|---|---|
| Free | 0 | 0 | 1 |
| Personal Pro | 8,000 | $3 | 1 |
| Team | 80,000 | $30 | 50 |
| Business | 260,000 | $100 | 51–250 |
| Enterprise | custom | $1–3 / user | custom |

Annual billing is charged at ten months (two free). Enterprise is `contactOnly`
and cannot be bought online — an attempt to check out returns a 400.

To change a price, edit `plans.js`. Nothing else stores an amount; the Stripe
line item is built from this catalogue at checkout time so the two cannot drift.

---

## 2. ClickPesa (mobile money)

### Get credentials

1. Sign in at <https://dashboard.clickpesa.com> and open **Developers →
   Applications**.
2. Create an application and enable **COLLECTION API** access on it. Without
   that scope the initiate call returns 400 with a "disabled COLLECTION API
   access" message.
3. Copy the **Client ID** and **API Key**.
4. Optional but recommended: generate a **Checksum Key** for the application.

### Set on the host (Render → Environment)

```
CLICKPESA_CLIENT_ID=your-client-id
CLICKPESA_API_KEY=your-api-key
CLICKPESA_CHECKSUM_KEY=your-checksum-key      # optional
```

Paste the values without surrounding quotes. Render stores them literally, and
a quoted value is sent to the gateway with the quotes still attached — which
comes back as `Invalid client details` and looks exactly like a wrong key.

### Check them before trusting them

```bash
node server/tools/clickpesa-check.js 0713455454 8000
```

Three checks in order: are the credentials present, do they authenticate, and
can that number actually be charged and for how much. The third uses the
gateway's `preview` endpoint, which reports the available wallets and their
fees **without sending a USSD prompt and without moving money**.

It prints no secrets — only whether each variable is set, its length, and
whether it arrived with stray quotes or whitespace. It also separates "the
gateway could not be reached" from "the gateway rejected these credentials",
which are different problems with different fixes.

There is deliberately no option to raise a real charge from the command line.
The first genuine payment should be made by a person, through the app, watching
their own handset.

Run it locally with the values you are about to set, or from Render's shell to
confirm what the deployment itself sees.

### Register the webhook

Point the application's webhook at:

```
https://smart-warning-relay.onrender.com/api/payments/mobile-money/webhook
```

Subscribe to **PAYMENT RECEIVED** and **PAYMENT FAILED**.

**The webhook is not load-bearing.** The handler treats a callback purely as a
hint that something changed and then asks ClickPesa directly what the status is
before provisioning anything. A deployment that never registers a webhook still
works — the reconciler polls pending transactions every 60 seconds, and the
checkout screen polls `/api/payments/status`. Registering it just makes
activation feel instant instead of taking up to a minute.

That design is also why a forged callback achieves nothing, and why the optional
checksum key is defence in depth rather than the only defence.

### Supported networks

Resolved from the number's prefix in [`server/payments/phone.js`](../server/payments/phone.js):

| Network | Prefixes (after 255) | Wallet |
|---|---|---|
| Mixx by Yas (Tigo) | 65, 67, 71 | Mixx |
| Vodacom | 74, 75, 76 | M-Pesa |
| Airtel | 68, 69, 78 | Airtel Money |
| Halotel | 61, 62 | HaloPesa |
| Zantel | 77 | EzyPesa |
| TTCL | 73 | *none — valid number, no wallet* |

The customer's number decides which network receives the push, not the button
they pressed in the UI. Picking "M-Pesa" and typing a Tigo number sends the
prompt to Mixx by Yas and says so on screen, rather than failing at the gateway.

---

## 3. Stripe (cards)

1. Get the secret key from **Developers → API keys** (`sk_live_…` / `sk_test_…`).
2. Add a webhook endpoint at
   `https://smart-warning-relay.onrender.com/api/payments/card/webhook`
   subscribed to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired` and
   `charge.refunded`.
3. Copy the signing secret (`whsec_…`).

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://smart-warning.vercel.app
```

Unlike the ClickPesa path, the Stripe signature **is** the proof — Stripe signs
the raw request body, the handler verifies it with a constant-time compare and a
5-minute replay window, and an unverified event is rejected with a 400.

---

## 4. Turning enforcement on

```
BILLING_ENFORCE=true
```

Leave this **off** at first. Every organization that predates billing migrates in
as `free`, so switching it on without preparation immediately paywalls dashboards
that are in daily use. While it is off, the API still reports each org's tier,
entitlements and seat usage — so upgrade prompts are truthful — and withholds
nothing.

When it is on, exactly two routes refuse: `/api/incidents` (incident history)
requires `incident_reports`, and `/api/stats` (analytics) requires
`advanced_analytics`. Both answer **402** with `alertingUnaffected: true`.

Before flipping it, decide what happens to existing customers. The usual answer
is to grandfather them:

```sql
UPDATE organizations SET tier = 'team' WHERE created_at < now();
UPDATE subscriptions  SET tier = 'team', previous_tier = 'team', status = 'active';
```

---

## 5. Subscription states

| State | Meaning | What the customer keeps |
|---|---|---|
| `active` | Paid and current | Their plan |
| `pending_payment` | USSD push sent, PIN not entered | Whatever they had **before** |
| `past_due` | Renewal failed, or money clawed back | Their plan, for a **14-day grace period** |
| `canceled` | Cancelled | Their plan until the paid period ends |
| `expired` | Period ended, no grace left | Free tier |

Two deliberate choices worth knowing about:

- **A renewal in flight never downgrades anyone.** `pending_payment` serves the
  *previous* tier, which for an existing customer is the tier they already have.
- **A failed renewal does not lock a supervisor out overnight.** Mobile money
  fails for mundane reasons — no balance on payday, phone switched off — and the
  fix is usually a retry within a day. The 14-day grace covers that.

---

## 6. Testing

```bash
cd server && npm test
```

41 tests, no database and no network required: phone normalisation, the price
list, entitlement transitions, ClickPesa checksums and status mapping, Stripe
signature verification, webhook idempotency, clawbacks, renewal arithmetic, and
the relay-level proof that a year-overdue organization can still raise an alarm.

### Against the real gateway

ClickPesa has no public sandbox with fake money — collections are live. To test
end to end you need real credentials and a small real charge on a real handset.
Nothing in this repository can do that for you, and no test here spends money.

Useful during a manual test:

```bash
# Is mobile money configured on this deployment?
curl -s https://smart-warning-relay.onrender.com/api/health | jq .channels

# Watch a payment resolve
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://smart-warning-relay.onrender.com/api/payments/status?reference=SW..."
```

---

## 7. Data model

| Table | Purpose |
|---|---|
| `organizations.tier` | Denormalised served tier, so the common read costs no join |
| `subscriptions` | One row per org: tier, status, cycle, period, billing phone |
| `transactions` | Every collection attempt; `order_reference` is UNIQUE |

Idempotency lives in `transactions.applied`, claimed by a conditional `UPDATE`
that returns a row exactly once. Every path that grants entitlement —
webhook, status poll, reconciler — goes through that claim, so five deliveries
of the same callback extend a subscription by one month, not five.
