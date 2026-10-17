// tools/smtp-check.js: the one-message production mail check. Runs against a
// throwaway local SMTP server; proves it sends exactly one message, reports a
// refusal as a failure, and never prints the password from SMTP_URL.
const { test, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { main } = require('../tools/smtp-check');

const servers = [];
after(() => { for (const s of servers) s.close(); });

// Minimal SMTP: AUTH PLAIN, MAIL, RCPT (optionally refused), DATA.
function fakeSmtp({ refuseRcpt = false } = {}) {
  const seen = { messages: 0, rcpt: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (buf) => {
      for (const line of buf.toString().split('\r\n')) {
        if (inData) {
          if (line === '.') { inData = false; seen.messages++; sock.write('250 queued as TEST1\r\n'); } else seen.data += `${line}\n`;
          continue;
        }
        if (!line) continue;
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') sock.write('235 ok\r\n');
        else if (cmd === 'MAIL') sock.write('250 ok\r\n');
        else if (cmd === 'RCPT') { seen.rcpt.push(line); sock.write(refuseRcpt ? '550 no such user\r\n' : '250 ok\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else if (cmd === 'RSET') sock.write('250 ok\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen })));
}

function capture() {
  const lines = [];
  return { lines, out: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) } };
}

test('sends exactly one message and says it was accepted, not delivered', async () => {
  const { port, seen } = await fakeSmtp();
  const { lines, out } = capture();
  const code = await main(['owner@example.com'], { SMTP_URL: `smtp://user:S3cret-Pa55@127.0.0.1:${port}?ignoreTLS=true` }, out);
  assert.strictEqual(code, 0);
  assert.strictEqual(seen.messages, 1);
  assert.match(seen.rcpt[0], /owner@example\.com/);
  assert.match(seen.data, /not an emergency alert/);
  assert.ok(lines.some((l) => /ACCEPTED/.test(l)) && lines.some((l) => /confirm it arrived/.test(l)));
  assert.ok(!lines.join('\n').includes('S3cret-Pa55'), 'the password never appears in the output');
});

test('a refused recipient is reported as NOT SENT and permanent', async () => {
  const { port } = await fakeSmtp({ refuseRcpt: true });
  const { lines, out } = capture();
  const code = await main(['owner@example.com'], { SMTP_URL: `smtp://user:S3cret-Pa55@127.0.0.1:${port}?ignoreTLS=true` }, out);
  assert.strictEqual(code, 1);
  assert.ok(lines.some((l) => /NOT SENT/.test(l) && /550/.test(l)));
  assert.ok(lines.some((l) => /permanent/.test(l)));
  assert.ok(!lines.join('\n').includes('S3cret-Pa55'));
});

test('refuses to run without SMTP_URL or a valid recipient, sending nothing', async () => {
  const { out, lines } = capture();
  assert.strictEqual(await main([], { SMTP_URL: 'smtp://x@127.0.0.1:1' }, out), 2);
  assert.strictEqual(await main(['not-an-email'], { SMTP_URL: 'smtp://x@127.0.0.1:1' }, out), 2);
  assert.strictEqual(await main(['owner@example.com'], {}, out), 2);
  assert.ok(lines.some((l) => /SMTP_URL is not set/.test(l)));
});
