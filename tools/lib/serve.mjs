// Tiny dependency-free static file server for the verification tools.
// startServer(root, port, { routes }) -> { server, port, url, close() }
//   routes: { '/path': async (req, res, body:Buffer, url) => void }   (any method; body is fully read; a key ending in '*' matches a prefix)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.woff2': 'font/woff2',
};

export function startServer(root, port = 0, { routes = {}, quiet = true } = {}) {
  const base = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const key = routes[pathname] ? pathname : Object.keys(routes).find((k) => k.endsWith('*') && pathname.startsWith(k.slice(0, -1)));
      if (key) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        await routes[key](req, res, Buffer.concat(chunks), url);
        if (!res.writableEnded) res.end();
        return;
      }
      let file = path.join(base, pathname);
      if (!file.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
      let st = fs.existsSync(file) ? fs.statSync(file) : null;
      if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.existsSync(file) ? fs.statSync(file) : null; }
      if (!st) { res.writeHead(404); res.end('not found: ' + pathname); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!quiet) console.error(e);
      res.writeHead(500); res.end(String(e && e.message));
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        server, port: p, url: `http://127.0.0.1:${p}`,
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}
