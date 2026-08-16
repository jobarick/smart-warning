# Release checklist

One branch (`main`), two hosts, and a push deploys both. That is convenient and
it is also why this list exists: there is no staging step to catch anything, so
the checks happen before the push.

Copy this into the PR or the commit, and tick as you go.

---

## Before the push

```bash
# 1. Tests — all of them, and read the count, not just the exit code
cd server && npm test          # expect: 150 pass, 0 fail

# 2. Types and build
cd ../client && npx tsc --noEmit
npm run build
```

- [ ] `server && npm test` — **0 failures** (the suite prints `ℹ fail 0`)
- [ ] `client && npx tsc --noEmit` — clean
- [ ] `client && npm run build` — exit 0

> ⚠️ **On Windows PowerShell, never pipe a native command through `2>&1`.** It
> wraps stderr in an ErrorRecord and makes a successful command report failure.
> Redirect to files and trust `$LASTEXITCODE`, never `$?`.

- [ ] **Service worker: test both visitors.** A cached visitor and a first-time
      visitor take different code paths, and only one of them is the one you
      just looked at.
  ```bash
  cd client && npx vite preview --port 5302
  ```
  - [ ] Fresh profile: the page loads, `/legal/privacy.html` shows the policy
  - [ ] Reload so the SW controls the page, then open `/legal/privacy.html`
        again — still the policy, **not** the app shell
  - [ ] An app route (`/settings`) still renders the app
- [ ] **Added a route?** It must be in `client/src/lib/routes.ts`, or it will
      silently stop working offline.
- [ ] **Touched pricing?** `plans.js` is the only source; the client must not
      hardcode a figure. Check the landing page and the billing screen agree.
- [ ] **Touched `terms.ts`?** Re-run `node tools/generate-legal.js` and commit
      the regenerated `docs/legal/*` and `client/public/legal/*`. Bumping
      `TERMS_VERSION` re-prompts every existing user for consent — intended or
      not, know which.
- [ ] `CHANGELOG.md` updated

## Lighthouse

```bash
cd client && npm run build && npx vite preview --port 5304
CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe" \
  npx lighthouse@12 http://localhost:5304/ --preset=desktop \
  --chrome-flags="--headless=new --no-sandbox" --view
```

- [ ] Performance ≥ 90 · Accessibility ≥ 95 · Best Practices ≥ 95 · SEO ≥ 95

> ⚠️ **Do not audit production while a deploy is running.** A Lighthouse run
> that caught Render mid-restart reported a 12.1s LCP against a real 1.5s —
> because the score was measuring a redeploy, not the site. Audit the local
> preview, or wait for the deploy to settle.

## Mobile

- [ ] Real device, not just the emulator
- [ ] No horizontal scroll at 375px — the target is *impossible*, not *unlikely*
- [ ] Tap targets ≥ 44px
- [ ] The entry gate's choose screen still fits one screen without scrolling

## Deploy

- [ ] `git push origin main` — Vercel and Render both build from this
- [ ] Wait for **both**. Render takes minutes; Vercel takes seconds.

## After the deploy

```bash
# the built bundle changed
curl -s https://smart-warning.vercel.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'

# the backend is healthy and reports the channels you expect
curl -s https://smart-warning-relay.onrender.com/api/health

# the legal redirects still redirect
curl -sI https://smart-warning.vercel.app/privacy | grep -iE 'HTTP/|location'
```

- [ ] Bundle hash matches what you just built
- [ ] `/api/health` — `database.ok: true`, channels as expected
- [ ] All four redirects return 307
- [ ] Landing page renders, pricing shows the figures the API serves
- [ ] `/legal/privacy.html` in a real browser, with the SW active

> ⚠️ **If Vercel serves a stale bundle, check the project Overview for an
> Instant Rollback before anything else.** A rollback pins the production alias
> against every newer deployment. This has been misdiagnosed as a broken Git
> integration more than once.

- [ ] If analytics is switched on: check GA4 Realtime for 30 minutes

---

## Not automated, and why

There is **no CI workflow**, deliberately. A GitHub Actions deploy workflow
existed once, was built around a misdiagnosis, failed on every push for want of
secrets nobody set, and was deleted. Both hosts deploy themselves from `main`.

A Lighthouse CI job that fails a build on a score drop is the one automation
worth adding — the manual step above is the thing most likely to get skipped.
It is not set up yet; the command is above so it is at least one paste away.
