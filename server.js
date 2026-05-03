'use strict';
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Passwords (set via environment variables or defaults) ─────────────────────
const DISPLAY_PASS = process.env.DISPLAY_PASS || 'display123';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'admin123';

// ── Database ──────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'data.json');

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
  return {
    settings: {
      shul_name: 'בית הכנסת', city_label: 'New York',
      latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York',
      ticker: '', simchas_title: 'שמחות', simchas_json: [],
      announcements_title: 'הודעות', announcements_json: [], contact_json: []
    },
    docs: [], nextId: 1
  };
}
function saveDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8'); }

// ── PDF Storage ───────────────────────────────────────────────────────────────
const PDF_DIR = path.join(__dirname, 'public', 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PDF_DIR),
    filename:    (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + '.pdf')
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDFs'))
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve public files (PDFs etc) — no auth needed for assets
app.use('/pdfs', express.static(path.join(__dirname, 'public', 'pdfs')));

// ── Auth middleware ───────────────────────────────────────────────────────────
function checkAuth(req, res, role) {
  const pass = role === 'admin' ? ADMIN_PASS : DISPLAY_PASS;
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${role}_auth=`));
  return token && token.split('=')[1] === pass;
}

// Login pages
app.get('/login/display', (req, res) => res.send(loginPage('display', 'Display')));
app.get('/login/admin',   (req, res) => res.send(loginPage('admin', 'Admin')));

app.post('/login/display', (req, res) => {
  if (req.body.password === DISPLAY_PASS) {
    res.setHeader('Set-Cookie', `display_auth=${DISPLAY_PASS}; Path=/; HttpOnly`);
    res.redirect('/display');
  } else {
    res.send(loginPage('display', 'Display', true));
  }
});

app.post('/login/admin', (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    res.setHeader('Set-Cookie', `admin_auth=${ADMIN_PASS}; Path=/; HttpOnly`);
    res.redirect('/admin');
  } else {
    res.send(loginPage('admin', 'Admin', true));
  }
});

// ── Protected pages ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/display'));

app.get('/display', (req, res) => {
  if (!checkAuth(req, res, 'display')) return res.redirect('/login/display');
  res.sendFile(path.join(__dirname, 'views', 'display.html'));
});

app.get('/admin', (req, res) => {
  if (!checkAuth(req, res, 'admin')) return res.redirect('/login/admin');
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ── API (admin protected) ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!checkAuth(req, res, 'admin')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

app.get('/api/settings', (req, res) => {
  const db = loadDb();
  const defaults = {
    shul_name: 'בית הכנסת', city_label: 'New York',
    latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York',
    ticker: '', simchas_title: 'שמחות', simchas_json: [],
    announcements_title: 'הודעות', announcements_json: [], contact_json: []
  };
  res.json({ ...defaults, ...db.settings });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  try {
    const db = loadDb(), b = req.body;
    db.settings = {
      ...db.settings,
      shul_name: b.shul_name, city_label: b.city_label,
      latitude: parseFloat(b.latitude)||0, longitude: parseFloat(b.longitude)||0,
      timezone: b.timezone||'America/New_York', ticker: b.ticker,
      simchas_title: b.simchas_title,
      simchas_json: parseLines(b.simchas_text||''),
      announcements_title: b.announcements_title,
      announcements_json: parseLines(b.announcements_text||''),
      contact_json: parseLines(b.contact_text||'')
    };
    saveDb(db);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/docs',        (req, res) => { const db=loadDb(); res.json([...db.docs].sort((a,b)=>a.display_order-b.display_order)); });
app.get('/api/docs/active', (req, res) => { const db=loadDb(); res.json(db.docs.filter(d=>d.is_active).sort((a,b)=>a.display_order-b.display_order)); });

app.post('/api/docs/upload', requireAdmin, upload.single('pdf'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
    const db = loadDb();
    const maxOrder = db.docs.reduce((m,d)=>Math.max(m,d.display_order),0);
    db.docs.push({ id: db.nextId++, title: req.file.originalname||'Document',
      file_path: '/pdfs/'+req.file.filename, display_order: maxOrder+1,
      duration_seconds: 20, is_active: true, uploaded_at: new Date().toISOString() });
    saveDb(db);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/api/docs/:id', requireAdmin, (req, res) => {
  try {
    const db=loadDb(), doc=db.docs.find(d=>d.id===parseInt(req.params.id));
    if (!doc) return res.status(404).json({ ok: false });
    const b=req.body;
    if (b.display_order!==undefined)    doc.display_order=parseInt(b.display_order);
    if (b.duration_seconds!==undefined) doc.duration_seconds=Math.max(1,parseInt(b.duration_seconds));
    if (b.is_active!==undefined)        doc.is_active=!!b.is_active;
    if (b.title!==undefined)            doc.title=b.title;
    saveDb(db); res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/docs/:id', requireAdmin, (req, res) => {
  try {
    const db=loadDb(), idx=db.docs.findIndex(d=>d.id===parseInt(req.params.id));
    if (idx===-1) return res.status(404).json({ ok: false });
    try { const p=path.join(__dirname,'public',db.docs[idx].file_path); if(fs.existsSync(p))fs.unlinkSync(p); } catch {}
    db.docs.splice(idx,1); saveDb(db); res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Login page HTML ───────────────────────────────────────────────────────────
function loginPage(role, label, error=false) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${label} Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:linear-gradient(135deg,#f5edcf,#e4d49c);
  height:100vh;display:flex;align-items:center;justify-content:center;}
.box{background:#fffdf0;border:1.5px solid #c8a040;border-radius:12px;
  padding:40px 44px;box-shadow:0 8px 40px rgba(60,30,0,.15);text-align:center;min-width:320px;}
.star{font-size:42px;color:#b8860b;margin-bottom:12px;}
h1{font-size:22px;font-weight:900;color:#4a2c0a;margin-bottom:6px;}
p{font-size:14px;color:#8b6830;margin-bottom:24px;}
input{width:100%;padding:11px 14px;border:1.5px solid #c8a040;border-radius:8px;
  font-size:15px;background:#fffef5;color:#4a2c0a;margin-bottom:14px;outline:none;}
input:focus{border-color:#b8860b;}
button{width:100%;padding:12px;background:linear-gradient(180deg,#d4a017,#b8860b);
  color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;}
button:hover{opacity:.9;}
.err{color:#c0392b;font-size:13px;margin-bottom:12px;font-weight:700;}
</style></head>
<body><div class="box">
  <div class="star">✡</div>
  <h1>Shul Display Board</h1>
  <p>${label} Access</p>
  ${error ? '<div class="err">❌ Wrong password, try again</div>' : ''}
  <form method="POST" action="/login/${role}">
    <input type="password" name="password" placeholder="Enter password" autofocus>
    <button type="submit">Enter →</button>
  </form>
</div></body></html>`;
}

function parseLines(text) {
  return (text||'').split('\n').map(l=>l.trim()).filter(Boolean)
    .map(l=>{ const p=l.split('|'); return {label:p[0]?.trim()||'',value:p[1]?.trim()||''}; });
}

app.listen(PORT, () => {
  console.log(`\n🕍  Shul Display Board running!`);
  console.log(`   Display: http://localhost:${PORT}/display`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`\n   Display password: ${DISPLAY_PASS}`);
  console.log(`   Admin password:   ${ADMIN_PASS}`);
  console.log(`\n   To change passwords, set env vars: DISPLAY_PASS and ADMIN_PASS\n`);
});
