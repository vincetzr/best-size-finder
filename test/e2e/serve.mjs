// A static file server for the end-to-end test: the repository at /, and one
// extra directory (the test's own media) at /media/. Nothing else.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function serve(root, media, port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let base = root;
    let rel = decodeURIComponent(url.pathname);
    if (rel.startsWith('/media/')) {
      base = media;
      rel = rel.slice('/media'.length);
    }
    const file = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(base)) return res.writeHead(403).end();
    fs.stat(file, (err, st) => {
      if (err) return res.writeHead(404).end('not found');
      const f = st.isDirectory() ? path.join(file, 'index.html') : file;
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
