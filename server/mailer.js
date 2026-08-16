// Backward-compatible facade over the mail service in ./mail.
//
// The original module was a single nodemailer transport with no queue: if SMTP
// was unset, feedback was stored and the email was simply never sent. The
// service behind this file keeps the same three exports so existing callers are
// untouched, and adds queueing, retry and automatic delivery of the backlog
// once a provider appears.
const mail = require('./mail');

module.exports = {
  enabled: mail.enabled,
  destination: mail.destination,
  sendFeedback: mail.sendFeedback,
  // Newer surface, for callers that want the queue directly.
  init: mail.init,
  send: mail.send,
  drain: mail.drain,
  stats: mail.stats,
  queueSnapshot: mail.queueSnapshot,
  providerName: mail.providerName,
  setProvider: mail.setProvider,
  providers: mail.providers,
};
