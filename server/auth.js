// Supervisor authentication: bcrypt password hashing + JWT sessions, plus the
// signup/login/lookup flows over the db layer. Workers don't authenticate here —
// they join an org with its code; only supervisors have accounts.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const mailer = require('./mailer');

// In production JWT_SECRET must be set. In dev we fall back to a random secret so
// the server still boots — tokens just don't survive a restart, which is fine.
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — using an ephemeral secret (sessions reset on restart)');
}
const TOKEN_TTL = '30d';
const BCRYPT_ROUNDS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ sub: user.id, org: user.org_id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Shape a user row for the client — never leak the password hash.
function publicUser(user, org) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone || null,
    org: org
      ? {
          id: org.id,
          name: org.name,
          joinCode: org.join_code,
          publicCode: org.public_code || null,
          adminName: org.admin_name || null,
          contactEmail: org.contact_email || null,
          phone: org.phone || null,
          industry: org.industry || null,
          address: org.address || null,
          country: org.country || null,
        }
      : undefined,
  };
}

// A phone number is stored as typed apart from obvious separators — numbering
// plans vary too much to validate beyond "plausible length, digits and +".
const PHONE_RE = /^\+?[0-9]{6,15}$/;

function normalizePhone(raw, { required = false, field = 'phone number' } = {}) {
  const cleaned = String(raw || '').replace(/[\s()\-.]/g, '');
  if (!cleaned) {
    if (required) throw httpError(400, `a ${field} is required`);
    return null;
  }
  if (!PHONE_RE.test(cleaned)) throw httpError(400, `that ${field} does not look valid`);
  return cleaned;
}

/**
 * Register an organization and its first supervisor.
 *
 * This is the account of record for a site: it captures who owns it and how to
 * reach them, so an organization is a durable customer rather than whatever
 * identity a third-party sign-in happened to return. Any social sign-in added
 * later should attach to an org created here, not replace this step.
 */
async function signup({ orgName, name, email, password, phone, adminName, contactEmail, industry, address, country }) {
  if (!orgName || !orgName.trim()) throw httpError(400, 'organization name is required');
  if (!name || !name.trim()) throw httpError(400, 'your name is required');
  if (!EMAIL_RE.test(email || '')) throw httpError(400, 'a valid email is required');
  if (!password || password.length < 8) throw httpError(400, 'password must be at least 8 characters');
  const orgPhone = normalizePhone(phone, { required: true, field: 'contact phone number' });
  if (contactEmail && !EMAIL_RE.test(contactEmail)) throw httpError(400, 'the organization contact email is not valid');

  if (await db.getUserByEmail(email)) throw httpError(409, 'an account with that email already exists');

  const org = await db.createOrg(orgName.trim(), {
    // The administrator defaults to the person registering, which is who they
    // are in practice — but it stays editable, because the ops owner and the
    // named administrator are not always the same person.
    adminName: (adminName || name).trim(),
    contactEmail: (contactEmail || email).toLowerCase(),
    phone: orgPhone,
    industry: industry || null,
    address: address || null,
    country: country || null,
  });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await db.createUser({ orgId: org.id, email, passwordHash, name: name.trim(), phone: orgPhone });
  return { token: signToken(user), user: publicUser(user, org) };
}

// Edit the organization profile. Supervisors only — enforced by the route.
async function updateOrg(orgId, body = {}) {
  if (body.contactEmail && !EMAIL_RE.test(body.contactEmail)) throw httpError(400, 'the organization contact email is not valid');
  const patch = { ...body };
  if (body.phone !== undefined) patch.phone = normalizePhone(body.phone) || '';
  if (body.name !== undefined && !String(body.name).trim()) throw httpError(400, 'organization name is required');
  const org = await db.updateOrgProfile(orgId, patch);
  if (!org) throw httpError(404, 'organization not found');
  return org;
}

async function login({ email, password }) {
  const user = await db.getUserByEmail(email);
  // Same error whether the email is unknown or the password is wrong.
  const ok = user && (await bcrypt.compare(password || '', user.password_hash));
  if (!ok) throw httpError(401, 'invalid email or password');
  const org = await db.getOrgById(user.org_id);
  return { token: signToken(user), user: publicUser(user, org) };
}

// --- Password reset ---------------------------------------------------------
//
// The person locked out here is the one who watches a site's emergencies. So
// this path is built to be usable under pressure and still safe:
//
//   • The response never says whether an email is registered. Otherwise this
//     endpoint becomes a way to ask "does this company use Smart Warning, and
//     who runs it" — which is reconnaissance, not a password reset.
//   • Only a hash of the token is stored (see db.js).
//   • One hour, one use.
//   • Whether mail actually left the building is reported honestly, because a
//     deployment with no SMTP credentials must not tell somebody to go and
//     check an inbox that will stay empty.

const RESET_TTL_MS = 60 * 60 * 1000;

// Where the reset link should point. Taken from configuration and never from
// the request's Host header: a forged Host would otherwise put an attacker's
// domain into an email we send, with a live token attached to it.
const APP_URL = (process.env.APP_URL || 'https://smart-warning.vercel.app').replace(/\/+$/, '');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Begin recovery for an email address.
 *
 * Always resolves. The caller answers the same way whether or not the account
 * exists; `mailConfigured` describes the deployment, not the account, so it
 * gives nothing away.
 */
async function requestPasswordReset({ email }) {
  const address = String(email || '').trim().toLowerCase();
  const out = { ok: true, mailConfigured: mailer.enabled() };
  if (!EMAIL_RE.test(address)) return out;

  const user = await db.getUserByEmail(address);
  if (!user) {
    console.log(`[auth] reset requested for an unknown address — answered normally`);
    return out;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await db.createPasswordReset({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  const link = `${APP_URL}/?reset=${token}`;
  const body = [
    `Hello ${user.name || 'there'},`,
    '',
    'Somebody asked to reset the password for your Smart Warning account.',
    'If that was you, open this link within the next hour:',
    '',
    link,
    '',
    'If the link does not open, start the app, choose "Forgot password?" and',
    'paste this code when it asks for one:',
    '',
    token,
    '',
    'If you did not ask for this, you can ignore this message — your password',
    'has not changed, and the link above stops working after an hour.',
    '',
    'Smart Warning — by Idefenda Lab',
  ].join('\n');

  const res = await mailer.send({
    to: user.email,
    subject: 'Reset your Smart Warning password',
    body,
    kind: 'password-reset',
    // Deliberately NOT keyed by user id: that would make the queue's unique
    // index collapse a second, legitimate request into the first one's row.
    refId: null,
    orgId: user.org_id || null,
  });
  console.log(`[auth] reset link issued for ${user.email} (delivered: ${res.delivered})`);
  return out;
}

/**
 * Finish recovery: spend the ticket and set the new password.
 *
 * Returns a signed-in session. The holder of the link has already proved
 * control of the registered address, and making somebody type the password
 * they have just chosen into a second form is friction with no security in it.
 */
async function resetPassword({ token, password }) {
  if (!token || typeof token !== 'string') throw httpError(400, 'that reset link is not valid');
  if (!password || password.length < 8) throw httpError(400, 'password must be at least 8 characters');

  const user = await db.consumePasswordReset(hashToken(token.trim()));
  if (!user) throw httpError(400, 'that reset link has expired or has already been used');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const updated = await db.setUserPassword(user.id, passwordHash);
  if (!updated) throw httpError(404, 'that account no longer exists');

  const org = await db.getOrgById(updated.org_id);
  console.log(`[auth] password reset completed for ${updated.email}`);
  return { token: signToken(updated), user: publicUser(updated, org) };
}

// Resolve the current user from a bearer token (for GET /api/auth/me and guards).
async function userFromToken(token) {
  const payload = token && verifyToken(token);
  if (!payload) return null;
  const user = await db.getUserById(payload.sub);
  if (!user) return null;
  const org = await db.getOrgById(user.org_id);
  return { user, org, orgId: user.org_id };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = {
  signup, login, updateOrg, userFromToken, verifyToken, publicUser, httpError, normalizePhone,
  requestPasswordReset, resetPassword,
};
