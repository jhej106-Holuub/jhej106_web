import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const port = Number(process.env.PORT || 4173);
const base = (process.env.SERVE_BASE || '').replace(/\/$/, '');
const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.xml':'application/xml', '.txt':'text/plain'};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = decodeURIComponent(url.pathname);
    if (base && route === '/') {
      res.writeHead(302, {Location: base + '/'}).end();
      return;
    }
    if (base && !route.startsWith(base + '/')) throw new Error('outside base');
    let filename = path.resolve(root, '.' + route.slice(base.length));
    if (!filename.startsWith(root + path.sep) && filename !== root) throw new Error('outside root');
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    res.writeHead(200, {'Content-Type': (types[path.extname(filename)] || 'application/octet-stream') + (filename.match(/\.(html|css|js|json|xml|txt)$/) ? '; charset=utf-8' : '')});
    res.end(await readFile(filename));
  } catch {
    res.writeHead(404, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(await readFile(path.join(root, '404.html')).catch(() => '404'));
  }
}).listen(port, '0.0.0.0', () => console.log('Localhost Diaries · http://localhost:' + port + base + '/'));
