import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ts':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server = http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let name;
  try { name = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err,stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
});
let port = Number(process.env.OREBODY_PORT || 4173);
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && port < 4193) { port++; server.listen(port,'127.0.0.1'); }
  else { console.error(err.message); process.exit(1); }
});
server.listen(port,'127.0.0.1',() => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  Orebody Taper Tool\n  ${url}\n\n  Keep this window open. Press Ctrl+C to stop.\n`);
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') execFile('cmd.exe',['/d','/c','start','',url]);
    else if(process.platform === 'darwin') execFile('open',[url]);
    else execFile('xdg-open',[url]);
  }
});
