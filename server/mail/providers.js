/**
 * Mail transport providers.
 *
 * A provider is deliberately tiny: `{ name, describe(), send(message) }` where
 * `send` resolves on acceptance and throws on failure. Everything about
 * queueing, retrying and backoff lives above this layer, so adding SES or
 * Postmark later means writing one function and touching nothing else.
 *
 * A `permanent` property on a thrown error means "this will never succeed" —
 * a malformed address, a rejected recipient — and stops the queue retrying it
 * forever. Anything without that flag is treated as transient, which is the
 * safe default: an unreachable host today is a deliverable message tomorrow.
 */

/** Refuses everything, loudly enough to be visible but without throwing. */
function nullProvider() {
  return {
    name: 'none',
    describe: () => 'no mail provider configured — messages stay queued',
    async send() {
      const err = new Error('no mail provider configured');
      err.transient = true;
      throw err;
    },
  };
}

/**
 * Development: prints the message instead of sending it, and reports success.
 *
 * The point is to make the whole path — queue, claim, send, mark sent — run
 * end to end on a laptop with no credentials, so the code that is exercised in
 * development is the same code that runs in production.
 */
function logProvider(log = console.log) {
  return {
    name: 'log',
    describe: () => 'development — messages are printed, not sent',
    async send(message) {
      log(
        `[mail] (log provider) to=${message.to} subject=${JSON.stringify(message.subject)}\n`
        + message.body.split('\n').map((l) => `      | ${l}`).join('\n'),
      );
      return { accepted: true, id: `log-${Date.now()}` };
    },
  };
}

/**
 * Test double. Captures messages and can be told to fail, so retry and backoff
 * behaviour is testable without a network.
 */
function memoryProvider() {
  const sent = [];
  let failWith = null;
  return {
    name: 'memory',
    describe: () => 'in-memory test provider',
    sent,
    /** Pass an Error to make subsequent sends fail; null to recover. */
    failNext(err) { failWith = err; },
    async send(message) {
      if (failWith) throw failWith;
      sent.push(message);
      return { accepted: true, id: `mem-${sent.length}` };
    },
  };
}

/**
 * Timeouts for an SMTP conversation.
 *
 * nodemailer sets none by default: a host that accepts a connection and then
 * stops talking holds the call open forever. That is how a hung mail server
 * became a hung HTTP request — the feedback route awaited delivery, and
 * delivery neither finished nor failed. Generous enough for a slow relay on a
 * bad link, short enough that a dead host fails and gets retried.
 */
const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000, // TCP connect
  greetingTimeout: 10_000,   // waiting for the server's banner
  socketTimeout: 20_000,     // silence mid-conversation
};

/**
 * Turn an SMTP connection URL into nodemailer transport options.
 *
 * Written by hand because of a trap that cost a production incident:
 * `createTransport(url, options)` looks like it takes transport options as the
 * second argument, and does not. Read nodemailer's own source — when the first
 * argument is a URL string it does `options = parseConnectionUrl(url)` and
 * builds the transport from that alone, while the second argument becomes
 * *message* defaults. Timeouts passed that way are silently ignored, which is
 * exactly what happened: the fix looked right, deployed, and changed nothing.
 *
 * Passing `{ url, ...timeouts }` does not work either — the same branch
 * replaces the whole object with the parsed URL.
 *
 * So: parse it here, and keep query parameters so existing configuration like
 * `?pool=true` still applies.
 */
function smtpOptions(url) {
  const u = new URL(url);
  const secure = u.protocol === 'smtps:';
  const options = {
    host: u.hostname,
    port: Number(u.port) || (secure ? 465 : 587),
    secure,
    ...SMTP_TIMEOUTS,
  };
  if (u.username) {
    options.auth = {
      user: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password || ''),
    };
  }
  // `?pool=true&maxConnections=3` and friends, coerced the way a config value
  // is meant to read rather than left as strings.
  for (const [k, v] of u.searchParams) {
    if (v === 'true' || v === 'false') options[k] = v === 'true';
    else if (v !== '' && !Number.isNaN(Number(v))) options[k] = Number(v);
    else options[k] = v;
  }
  return options;
}

/**
 * Production: real SMTP via nodemailer.
 *
 * `require` is deliberately inside the factory. This is a life-safety relay and
 * mail is not on its critical path, so a missing or broken optional dependency
 * must degrade to "queued" rather than stop the process booting.
 */
function smtpProvider(url, { from }) {
  let transport;
  try {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport(smtpOptions(url));
  } catch (e) {
    const err = new Error(`SMTP configured but nodemailer is unavailable: ${e.message}`);
    err.fatal = true;
    throw err;
  }
  return {
    name: 'smtp',
    describe: () => `SMTP via ${String(url).replace(/\/\/[^@]*@/, '//***@')}`,
    async send(message) {
      try {
        const info = await transport.sendMail({
          from,
          to: message.to,
          replyTo: message.replyTo || undefined,
          subject: message.subject,
          text: message.body,
        });
        return { accepted: true, id: info.messageId };
      } catch (e) {
        // 5xx is the SMTP family for "do not bother trying again".
        const code = Number(e.responseCode);
        if (code >= 500 && code < 600) e.permanent = true;
        throw e;
      }
    },
  };
}

/**
 * Choose a provider from the environment.
 *
 * MAIL_PROVIDER overrides the choice explicitly (smtp | log | none); otherwise
 * the presence of SMTP_URL decides, and a developer with nothing configured
 * gets the log provider so the pipeline is still observable end to end.
 */
function fromEnv(env = process.env, { from } = {}) {
  const explicit = (env.MAIL_PROVIDER || '').toLowerCase();
  const url = env.SMTP_URL || '';

  if (explicit === 'none') return nullProvider();
  if (explicit === 'log') return logProvider();
  if (explicit === 'smtp' || (!explicit && url)) {
    if (!url) {
      console.warn('[mail] MAIL_PROVIDER=smtp but SMTP_URL is not set — messages will stay queued');
      return nullProvider();
    }
    try {
      return smtpProvider(url, { from });
    } catch (e) {
      console.warn(`[mail] ${e.message} — messages will stay queued`);
      return nullProvider();
    }
  }
  // Nothing configured. In production that must be visible rather than faked,
  // so queued-and-waiting is the honest state; in development, printing the
  // message is more useful than silence.
  return env.NODE_ENV === 'production' ? nullProvider() : logProvider();
}

module.exports = { nullProvider, logProvider, memoryProvider, smtpProvider, fromEnv, smtpOptions };
