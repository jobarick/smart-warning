// Deployment-shaped facts, resolved once at boot.
//
// Every one of these is read from the environment at require time, which is
// what lets a test set an environment variable, stub ./db, and then require the
// server to get a deployment of a particular shape. Nothing here changes while
// the process runs.
const db = require('./db');

const PORT = process.env.PORT || 3001;

// Legacy shared token, only consulted when orgs are disabled (i.e. no database).
const TOKEN = process.env.RELAY_TOKEN || '';

// Orgs + accounts are active whenever persistence is configured. With no
// DATABASE_URL the relay runs in-memory as a single global room, exactly as it
// did before multi-tenancy — which keeps LAN and dev zero-config.
const ORGS = db.enabled();

// Whether subscription tiers actually withhold anything.
//
// Off by default, and deliberately so: every organization that predates billing
// migrates in as 'free', and switching this on without warning would paywall
// dashboards that are already in daily use. Deployments turn it on when they
// are ready to sell. While it is off the API still reports each org's tier and
// entitlements, so the UI can show upgrade prompts truthfully before a single
// feature is withheld.
//
// It has no bearing whatsoever on alerting — see billing/entitlements.js.
const BILLING_ENFORCE = /^(1|true|yes)$/i.test(process.env.BILLING_ENFORCE || '');

module.exports = { PORT, TOKEN, ORGS, BILLING_ENFORCE };
