# Email setup

Like Firebase, the code is finished. Supply `SMTP_URL` and the backlog delivers
itself — no migration, no manual step, no code change.

## The design in one paragraph

SMTP credentials live outside the code, so the most likely state of any fresh
deployment is "no mail provider". That must never lose a user's submission and
must never look like success. So every message is **written to the
`outbound_mail` table first and attempted second**. With no provider configured,
rows accumulate as `pending` and the API reports them as undelivered. The moment
`SMTP_URL` is set and the service restarts, the drain loop delivers the backlog.
*Nothing is lost* is therefore a property of the schema, not a promise about
operations.

## Providers

Selected by environment. `MAIL_PROVIDER` overrides; otherwise the presence of
`SMTP_URL` decides.

| `MAIL_PROVIDER` | `SMTP_URL` | Provider | Behaviour |
|---|---|---|---|
| *(unset)* | set | `smtp` | Real delivery via nodemailer |
| *(unset)* | unset, `NODE_ENV=production` | `none` | Queued, never claimed as sent |
| *(unset)* | unset, development | `log` | Printed to the console, reported delivered |
| `smtp` | set | `smtp` | Real delivery |
| `smtp` | unset | `none` | Warns, then queues |
| `log` | any | `log` | Printed |
| `none` | any | `none` | Queued only |

The `log` provider exists so the entire path — queue, claim, send, mark sent —
runs on a laptop with no credentials. The code exercised in development is the
code that runs in production.

## Configure it

On Render → your service → **Environment**:

| Variable | Required | Example |
|---|---|---|
| `SMTP_URL` | yes | `smtps://user:pass@smtp.gmail.com:465` |
| `SMTP_FROM` | no | `Smart Warning <no-reply@yourdomain.com>` |
| `FEEDBACK_TO` | no | `you@yourdomain.com` (defaults to `jobarick@gmail.com`) |
| `MAIL_PROVIDER` | no | Only to override the automatic choice |

Use `smtps://` for implicit TLS on port 465, `smtp://` for STARTTLS on 587.
Percent-encode any `@ : / ?` in the password.

**Gmail** requires an [App Password](https://myaccount.google.com/apppasswords)
with 2FA enabled — your normal password will not authenticate. Providers built
for transactional mail (SendGrid, Mailgun, Postmark, SES) are a better fit for
production volume and all expose an SMTP endpoint that works here unchanged.

Redeploy. The log reads:

```
[mail] provider: smtp — SMTP via smtps://***@smtp.gmail.com:465
[mail] drained 3 sent, 0 deferred
```

Credentials are redacted in that line by design.

## Verify

```bash
curl https://smart-warning-relay.onrender.com/api/health
```

`channels.mail` is `true` and `channels.mailProvider` names the provider.

## Retry behaviour

- **Backoff doubles** from 1 minute, capped at 1 hour. A long outage keeps
  retrying hourly rather than giving up.
- **Rows stay `pending` however many times they fail.** A message that cannot be
  delivered today because nobody configured SMTP must still go out the day
  somebody does. Only a permanent rejection (SMTP 5xx) moves a row to `failed`.
- **Claiming is concurrency-safe.** `claimDueMail` uses
  `UPDATE … FOR UPDATE SKIP LOCKED` and pushes `next_attempt` forward before
  handing a row out, so two instances draining at once cannot both send it.
- **Sending is idempotent per reference.** A unique index on `(kind, ref_id)`
  means a resubmitted feedback row cannot produce two emails.
- The sweep runs every 60 seconds, and once at boot before anyone asks.

## What is wired up today

Only **feedback** currently composes mail (`mail.sendFeedback`). The service
takes arbitrary messages, so the following are now a call each rather than an
infrastructure project:

- Incident summaries after stand-down
- Weekly safety reports
- Organization registration confirmation
- Password reset

Password reset additionally needs a token table and routes, which do not exist.

## Without a database

The LAN/dev relay has no durable storage of any kind, so there is nowhere to
queue. A message is attempted once and its success reported honestly. This is
the one path where a failure is genuinely lost, and it is the mode with no
users to lose anything for.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `channels.mail: false` in production | `SMTP_URL` unset — messages are queuing safely |
| `provider: log` in production | `NODE_ENV` is not `production`; nothing is really sending |
| `SMTP configured but nodemailer is unavailable` | `npm ci` did not run in `server/` |
| Rows stuck `pending`, no attempts | Provider is `none`; check `MAIL_PROVIDER` |
| `Invalid login` on Gmail | Needs an App Password, not the account password |
| Queue grows forever | Check `last_error` on `outbound_mail` |

```sql
SELECT status, count(*), max(attempts), max(last_error)
FROM outbound_mail GROUP BY status;
```
