const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 目录配置
const ROOT_DIR = path.resolve(__dirname, '..');
const CAIZI_DIR = path.join(ROOT_DIR, 'caizi-data');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const WEB_DIR = __dirname;

// 确保 caizi-data 目录存在
if (!fs.existsSync(CAIZI_DIR)) fs.mkdirSync(CAIZI_DIR, { recursive: true });

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(filePath, res) {
  // 安全检查
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT_DIR) && !resolved.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function safeName(name) {
  return name.replace(/[\/\\]/g, '_').replace(/\0/g, '');
}

// ====== HTTP 服务 ======
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API 路由
  if (pathname === '/api/caizi' && req.method === 'GET') {
    const group = url.searchParams.get('group');
    if (group) {
      const fp = path.join(CAIZI_DIR, safeName(group) + '.json');
      if (fs.existsSync(fp)) {
        const items = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        sendJson(res, { name: group, items });
      } else {
        sendJson(res, { error: 'not found' }, 404);
      }
    } else {
      const result = {};
      for (const f of fs.readdirSync(CAIZI_DIR)) {
        if (f.endsWith('.json')) {
          const name = f.slice(0, -5);
          result[name] = JSON.parse(fs.readFileSync(path.join(CAIZI_DIR, f), 'utf-8'));
        }
      }
      sendJson(res, result);
    }
    return;
  }

  if (pathname === '/api/caizi/save' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const fp = path.join(CAIZI_DIR, safeName(body.name) + '.json');
      fs.writeFileSync(fp, JSON.stringify(body.items, null, 2), 'utf-8');
      sendJson(res, { ok: true, name: body.name, count: body.items.length });
    } catch (e) {
      sendJson(res, { error: e.message }, 400);
    }
    return;
  }

  if (pathname === '/api/caizi/delete' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const fp = path.join(CAIZI_DIR, safeName(body.name) + '.json');
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        sendJson(res, { ok: true });
      } else {
        sendJson(res, { error: 'not found' }, 404);
      }
    } catch (e) {
      sendJson(res, { error: e.message }, 400);
    }
    return;
  }

  // 静态文件：优先 app/ 目录，然后 data/ 目录
  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(WEB_DIR, 'index.html');
  } else {
    filePath = path.join(WEB_DIR, pathname);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(DATA_DIR, pathname);
    }
  }
  serveStatic(filePath, res);
});

// 获取可用端口
function getPort() {
  return new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

let mainWindow;

app.whenReady().then(async () => {
  const port = await getPort();
  server.listen(port, '127.0.0.1', () => {
    console.log(`服务已启动: http://localhost:${port}`);
    console.log(`谜材数据目录: ${CAIZI_DIR}`);
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: '字根反查',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());
