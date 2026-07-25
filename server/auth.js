// Supervisor authentication: bcrypt password hashing + JWT sessions, plus the
// signup/login/lookup flows over the db layer. Workers don't authenticate here —
// they join an org with its code; only supervisors have accounts.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

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
    org: org ? { id: org.id, name: org.name, joinCode: org.join_code } : undefined,
  };
}

// Create an organization and its first supervisor in one step.
async function signup({ orgName, name, email, password }) {
  if (!orgName || !orgName.trim()) throw httpError(400, 'organization name is required');
  if (!name || !name.trim()) throw httpError(400, 'your name is required');
  if (!EMAIL_RE.test(email || '')) throw httpError(400, 'a valid email is required');
  if (!password || password.length < 8) throw httpError(400, 'password must be at least 8 characters');

  if (await db.getUserByEmail(email)) throw httpError(409, 'an account with that email already exists');

  const org = await db.createOrg(orgName.trim());
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await db.createUser({ orgId: org.id, email, passwordHash, name: name.trim() });
  return { token: signToken(user), user: publicUser(user, org) };
}

async function login({ email, password }) {
  const user = await db.getUserByEmail(email);
  // Same error whether the email is unknown or the password is wrong.
  const ok = user && (await bcrypt.compare(password || '', user.password_hash));
  if (!ok) throw httpError(401, 'invalid email or password');
  const org = await db.getOrgById(user.org_id);
  return { token: signToken(user), user: publicUser(user, org) };
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

module.exports = { signup, login, userFromToken, verifyToken, publicUser, httpError };
