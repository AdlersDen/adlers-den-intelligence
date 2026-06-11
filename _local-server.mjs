// Lightweight local server that imports api/*.js handlers directly.
// Mimics Vercel's serverless function signature (req.body parsed, res.status/json).
// Loads .env then .env.local (override) manually — no dotenv dependency needed.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

function loadEnvFile(path, override = false) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (!override && process.env[key]) continue;
    process.env[key] = val.replace(/^["']|["']$/g, '');
  }
}
loadEnvFile('.env', false);
loadEnvFile('.env.local', true);

const routes = {
  '/api/fetch-product':       (await import('./api/fetch-product.js')).default,
  '/api/extract-composition': (await import('./api/extract-composition.js')).default,
  '/api/search-competitors':  (await import('./api/search-competitors.js')).default,
  '/api/analyse':             (await import('./api/analyse.js')).default,
};

function makeRes(httpRes) {
  const res = {
    _status: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; return this; },
    status(code) { this._status = code; return this; },
    json(obj) {
      httpRes.writeHead(this._status, { ...this._headers, 'content-type': 'application/json' });
      httpRes.end(JSON.stringify(obj));
      return this;
    },
    send(text) {
      httpRes.writeHead(this._status, { ...this._headers, 'content-type': 'text/plain' });
      httpRes.end(typeof text === 'string' ? text : JSON.stringify(text));
      return this;
    },
    end(...args) { httpRes.end(...args); return this; },
  };
  return res;
}

const server = createServer(async (httpReq, httpRes) => {
  const handler = routes[httpReq.url];
  if (!handler) {
    httpRes.writeHead(404, { 'content-type': 'text/plain' });
    httpRes.end('Not found');
    return;
  }

  let raw = '';
  for await (const chunk of httpReq) raw += chunk;
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

  const req = { method: httpReq.method, headers: httpReq.headers, url: httpReq.url, body };
  const res = makeRes(httpRes);

  try {
    await handler(req, res);
  } catch (err) {
    console.error(`[${httpReq.url}] error:`, err.message);
    if (!httpRes.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Local API server listening on http://localhost:${PORT}`);
  console.log('Routes:', Object.keys(routes).join(', '));
});
