// The vocabulary of the wire protocol, and the coercion that keeps a client
// from writing whatever it likes into it.
//
// Both halves of the server validate against the same sets: an escalated public
// report arrives over REST rather than the relay, and it gets exactly the same
// strict enum check the socket path relies on. One list, two doors.
const ALERT_TYPES = new Set(['fire', 'medical', 'security', 'hazard', 'cyber', 'evacuation']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

// Device-reported state.
const STATUSES = new Set(['safe', 'sos', 'idle']);
const ROLES = new Set(['worker', 'supervisor']);

// Standing site status, set by a supervisor.
const STATUS_LEVELS = new Set(['clear', 'watch', 'emergency']);

// Row ids are UUIDs; anything else makes Postgres raise 22P02, which would
// surface as a 500 for what is really just an unknown id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Title-cased alert type for notification copy, e.g. "fire" → "Fire".
function titleCase(s) {
  return typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : 'Alert';
}

// Never trust a client — coerce reported telemetry into a known shape.
function sanitizeWorker(msg, connId) {
  const id = typeof msg.id === 'string' && msg.id ? msg.id : `conn-${connId}`;
  const battery = numOrNull(msg.battery);
  return {
    id,
    name: typeof msg.name === 'string' ? msg.name : 'Unknown',
    role: ROLES.has(msg.role) ? msg.role : 'worker',
    status: STATUSES.has(msg.status) ? msg.status : 'safe',
    zone: typeof msg.zone === 'string' ? msg.zone : '',
    battery: battery === null ? null : Math.max(0, Math.min(1, battery)),
    charging: msg.charging === true,
    lat: numOrNull(msg.lat),
    lng: numOrNull(msg.lng),
    accuracy: numOrNull(msg.accuracy),
    // A personal "I am safe", carrying the id of the incident it answers. The
    // relay does not interpret it — it only has to survive the round trip
    // intact, because a mismatch means "not accounted for" and that is the
    // direction a roll call should fail in.
    safeFor: typeof msg.safeFor === 'string' && msg.safeFor ? msg.safeFor.slice(0, 64) : null,
    updatedAt: Date.now(),
  };
}

module.exports = {
  ALERT_TYPES, SEVERITIES, STATUSES, ROLES, STATUS_LEVELS, UUID_RE,
  numOrNull, titleCase, sanitizeWorker,
};
