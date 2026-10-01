'use strict';

/**
 * HTTP failure modes of the National Library client (final review I-1 / M-1): every failure must
 * become NlgUnavailableError quickly, so the wizard can offer local cataloguing.
 */

const http = require('http');

let server;
let nlg;
let NlgUnavailableError;
const sockets = new Set();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q');
    if (q === 'drop') {
      // headers and half a body, then the connection is cut
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      res.write('<rss version="2.0"><channel>');
      setTimeout(() => res.socket.destroy(), 20);
    } else if (q === 'trickle') {
      // never idle, never finished: only a hard deadline stops it
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      const timer = setInterval(() => res.write(' '), 50);
      res.on('close', () => clearInterval(timer));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      res.end('<rss version="2.0"><channel><item><link>x?biblionumber=7</link></item></channel></rss>');
    }
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NLG_CATALOGUE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.NLG_TIMEOUT_MS = '400';
  nlg = require('../../src/api/magazine/services/nlg');
  ({ NlgUnavailableError } = require('../../src/utils/catalog-errors'));
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => server.close(resolve));
});

const timed = async (promise) => {
  const started = Date.now();
  const outcome = await promise.then((v) => ({ value: v }), (e) => ({ error: e }));
  return { ...outcome, ms: Date.now() - started };
};

test('a normal answer still works over http', async () => {
  expect(await nlg.searchSerialsByIssn('ok')).toEqual(['7']);
});

test('connection cut mid-response → unavailable at once (I-1)', async () => {
  const { error, ms } = await timed(nlg.searchSerialsByIssn('drop'));
  expect(error).toBeInstanceOf(NlgUnavailableError);
  expect(ms).toBeLessThan(350);
});

test('a response that never ends is stopped by a hard deadline (M-1)', async () => {
  const { error, ms } = await timed(nlg.searchSerialsByIssn('trickle'));
  expect(error).toBeInstanceOf(NlgUnavailableError);
  expect(ms).toBeLessThan(1500);
});

test('the caller\'s overall deadline shortens the call (M-1)', async () => {
  const { error, ms } = await timed(nlg.searchSerialsByIssn('trickle', Date.now() + 100));
  expect(error).toBeInstanceOf(NlgUnavailableError);
  expect(ms).toBeLessThan(350);
});

test('an already expired deadline fails without a request', async () => {
  const { error } = await timed(nlg.getBiblio('1', Date.now() - 1));
  expect(error).toBeInstanceOf(NlgUnavailableError);
});
