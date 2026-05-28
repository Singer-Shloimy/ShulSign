'use strict';
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const DISPLAY_PASS = process.env.DISPLAY_PASS || 'display123';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'admin123';

// ── Folders ──────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const PDF_DIR  = path.join(__dirname, 'public', 'pdfs');
const LOGO_DIR = path.join(__dirname, 'public', 'logo');
const LOGO_FILE= path.join(LOGO_DIR, 'logo.png');
[DATA_DIR, PDF_DIR, LOGO_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const DB_FILE = path.join(DATA_DIR, 'data.json');
const LIMUDIM_SCHEDULE_FILE = path.join(DATA_DIR, 'limudim_schedule.txt');

// ── DB ────────────────────────────────────────────────────────────────────────
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
  return {
    settings: {
      shul_name: 'בית הכנסת', city_label: 'New York',
      latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York',
      ticker: '',
      simchas_title: 'שמחות', simchas_json: [],
      announcements_title: 'הודעות', announcements_json: [],
      contact_json: [],
      learning_json: [],
      company_name: 'Shloma Singer', company_sub: 'Software Engineering'
    },
    docs: [], nextId: 1
  };
}
function saveDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
function parseLines(text) {
  return (text||'').split('\n').map(l=>l.trim()).filter(Boolean)
    .map(l=>{ const p=l.split('|'); return {label:(p[0]||'').trim(), value:(p[1]||'').trim()}; });
}

function stripUtf8Bom(s){
  return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;
}

function looksLikeMojibake(s){
  // Typical pattern when UTF-8 Hebrew was decoded as latin1/cp1252: "×ª×�×¨..."
  // If there's lots of '×' and almost no Hebrew codepoints, try to repair.
  if(!s) return false;
  const hebrewCount = (s.match(/[\u0590-\u05FF]/g) || []).length;
  const timesCount = (s.match(/×/g) || []).length;
  return timesCount > 10 && hebrewCount < 3;
}

function readTextFileSmart(filePath){
  const buf = fs.readFileSync(filePath);
  let text = stripUtf8Bom(buf.toString('utf8'));

  // If decoding as utf8 didn't yield real Hebrew, attempt mojibake repair.
  // This fixes files that were saved in UTF-8 but later read/treated as latin1 somewhere.
  if(looksLikeMojibake(text)){
    const latin1 = buf.toString('latin1');
    const repaired = stripUtf8Bom(Buffer.from(latin1, 'latin1').toString('utf8'));
    if((repaired.match(/[\u0590-\u05FF]/g) || []).length > (text.match(/[\u0590-\u05FF]/g) || []).length){
      text = repaired;
    }
  }
  return text;
}

function tzDateISO(tz){
  // YYYY-MM-DD in the configured timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (t)=>parts.find(p=>p.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseLimudimSchedule(text){
  // Input lines are like:
  // תאריך לועזי: 2025-10-23 00:00:00 | יום בשבוע :  יום ה | תאריך עברי: ... | הלכה יומית: ... | דף היומי : ... | ...
  const map = {};
  const lines = (text||'').split('\n').map(l=>l.trim()).filter(Boolean);
  for(const line of lines){
    if(!line.includes('תאריך לועזי')) continue;
    const parts = line.split('|').map(p=>p.trim()).filter(Boolean);
    const kv = {};
    for(const p of parts){
      const idx = p.indexOf(':');
      if(idx === -1) continue;
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx+1).trim();
      kv[k] = v;
    }
    const dateRaw = kv['תאריך לועזי'];
    if(!dateRaw) continue;
    const dateIso = String(dateRaw).trim().slice(0, 10); // YYYY-MM-DD
    const items = [];

    // Choose which fields to show in the learning panel (custom schedule)
    const add = (label, value)=>{
      const v = (value||'').toString().trim();
      if(v) items.push({ label, value: v });
    };

    add('תאריך עברי', kv['תאריך עברי']);
    add('הלכה יומית', kv['הלכה יומית']);
    add('אהבת תורה', kv['אהבת תורה']);

    // Mishnayos details: prefer the "מקוצר" if present, else build from fields.
    if(kv['מקוצר']){
      add('משניות', kv['מקוצר']);
    }else{
      const mish = kv['משניות'];
      const perek = kv['פרק'];
      const mishna = kv['משנה'];
      const joined = [mish && `מסכת: ${mish}`, perek && `פרק: ${perek}`, mishna && `משנה: ${mishna}`].filter(Boolean).join(' | ');
      add('משניות', joined);
    }

    // Optionally include weekday line
    add('יום בשבוע', kv['יום בשבוע']);

    // Merge multiple lines for the same date (if any)
    map[dateIso] = [...(map[dateIso] || []), ...items].filter(i=>i.value);
  }
  return map;
}

// ── Multer ────────────────────────────────────────────────────────────────────
const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => cb(null, PDF_DIR),
    filename: (_,f,cb) => cb(null, Date.now()+'-'+Math.random().toString(36).slice(2)+'.pdf')
  }),
  limits: { fileSize: 200*1024*1024 },
  fileFilter: (_,f,cb) => f.mimetype==='application/pdf' ? cb(null,true) : cb(new Error('PDFs only'))
});

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => cb(null, LOGO_DIR),
    filename: (_,f,cb) => cb(null, 'logo_new'+path.extname(f.originalname))
  }),
  limits: { fileSize: 10*1024*1024 },
  fileFilter: (_,f,cb) => /^image\//.test(f.mimetype) ? cb(null,true) : cb(new Error('Images only'))
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/pdfs', express.static(PDF_DIR));
app.use('/public', express.static(path.join(__dirname,'public')));

// Serve KosherZmanim library from local node_modules (works offline after npm install)
app.get('/lib/kosher-zmanim.min.js', (req, res) => {
  const libPath = path.join(__dirname, 'node_modules', 'kosher-zmanim', 'dist', 'kosher-zmanim.min.js');
  if (require('fs').existsSync(libPath)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(libPath);
  } else {
    // Library not installed yet - tell browser to use CDN fallback
    res.status(404).json({ error: 'Run npm install first' });
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth(req, role) {
  const pass = role==='admin' ? ADMIN_PASS : DISPLAY_PASS;
  const cookie = req.headers.cookie||'';
  const tok = cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith(role+'_auth='));
  return tok && tok.split('=')[1]===pass;
}
function requireAdmin(req,res,next){ if(!checkAuth(req,'admin')) return res.status(401).json({ok:false,error:'Unauthorized'}); next(); }

// ── Login ─────────────────────────────────────────────────────────────────────
const loginHtml = (role,label,err=false) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${label} Login</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#f5edcf,#e4d49c);height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#fffdf0;border:1.5px solid #c8a040;border-radius:12px;padding:40px 44px;box-shadow:0 8px 40px rgba(60,30,0,.15);text-align:center;min-width:320px}
.icon{font-size:42px;color:#b8860b;margin-bottom:12px}
h1{font-size:22px;font-weight:900;color:#4a2c0a;margin-bottom:6px}
p{font-size:14px;color:#8b6830;margin-bottom:24px}
input{width:100%;padding:11px 14px;border:1.5px solid #c8a040;border-radius:8px;font-size:15px;background:#fffef5;color:#4a2c0a;margin-bottom:14px;outline:none}
button{width:100%;padding:12px;background:linear-gradient(180deg,#d4a017,#b8860b);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer}
.err{color:#c0392b;font-size:13px;margin-bottom:12px;font-weight:700}</style></head>
<body><div class="box"><div class="icon">✡</div><h1>Shul Display Board</h1><p>${label} Access</p>
${err?'<div class="err">❌ Wrong password</div>':''}
<form method="POST" action="/login/${role}"><input type="password" name="password" placeholder="Enter password" autofocus><button>Enter →</button></form>
</div></body></html>`;

app.get('/login/display', (_,res) => res.send(loginHtml('display','Display')));
app.get('/login/admin',   (_,res) => res.send(loginHtml('admin','Admin')));

app.post('/login/display', (req,res) => {
  if(req.body.password===DISPLAY_PASS){ res.setHeader('Set-Cookie',`display_auth=${DISPLAY_PASS}; Path=/; HttpOnly`); res.redirect('/display'); }
  else res.send(loginHtml('display','Display',true));
});
app.post('/login/admin', (req,res) => {
  if(req.body.password===ADMIN_PASS){ res.setHeader('Set-Cookie',`admin_auth=${ADMIN_PASS}; Path=/; HttpOnly`); res.redirect('/admin'); }
  else res.send(loginHtml('admin','Admin',true));
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (_,res) => res.redirect('/display'));
app.get('/display', (req,res) => {
  if(!checkAuth(req,'display')) return res.redirect('/login/display');
  res.sendFile(path.join(__dirname,'views','display.html'));
});
app.get('/admin', (req,res) => {
  if(!checkAuth(req,'admin')) return res.redirect('/login/admin');
  res.sendFile(path.join(__dirname,'views','admin.html'));
});

// ── Settings API ──────────────────────────────────────────────────────────────
app.get('/api/settings', (_,res) => {
  const db = loadDb();
  const defaults = {
    shul_name:'בית הכנסת', city_label:'New York',
    latitude:40.7128, longitude:-74.006, timezone:'America/New_York',
    ticker:'', simchas_title:'שמחות', simchas_json:[],
    announcements_title:'הודעות', announcements_json:[], contact_json:[],
    learning_json:[], company_name:'Shloma Singer', company_sub:'Software Engineering'
  };
  res.json({...defaults, ...db.settings});
});

app.post('/api/settings', requireAdmin, (req,res) => {
  try{
    const db=loadDb(), b=req.body;
    db.settings = {
      ...db.settings,
      shul_name: b.shul_name||'בית הכנסת',
      city_label: b.city_label||'New York',
      latitude: parseFloat(b.latitude)||40.7128,
      longitude: parseFloat(b.longitude)||-74.006,
      timezone: b.timezone||'America/New_York',
      ticker: b.ticker||'',
      simchas_title: b.simchas_title||'שמחות',
      simchas_json: parseLines(b.simchas_text||''),
      announcements_title: b.announcements_title||'הודעות',
      announcements_json: parseLines(b.announcements_text||''),
      contact_json: parseLines(b.contact_text||''),
      learning_json: parseLines(b.learning_text||''),
      company_name: b.company_name||'Shloma Singer',
      company_sub: b.company_sub||'Software Engineering'
    };
    saveDb(db);
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── Docs API ──────────────────────────────────────────────────────────────────
app.get('/api/docs', (_,res) => { const db=loadDb(); res.json([...db.docs].sort((a,b)=>a.display_order-b.display_order)); });
app.get('/api/docs/active', (_,res) => { const db=loadDb(); res.json(db.docs.filter(d=>d.is_active).sort((a,b)=>a.display_order-b.display_order)); });

// ── Limudim schedule API ───────────────────────────────────────────────────────
app.get('/api/limudim/today', (_, res) => {
  try{
    const db = loadDb();
    const tz = (db.settings && db.settings.timezone) || 'America/New_York';
    const today = tzDateISO(tz);
    if(!fs.existsSync(LIMUDIM_SCHEDULE_FILE)) return res.json([]);
    const raw = readTextFileSmart(LIMUDIM_SCHEDULE_FILE);
    const schedule = parseLimudimSchedule(raw);
    res.json(schedule[today] || []);
  }catch(e){
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.post('/api/docs/upload', requireAdmin, pdfUpload.single('pdf'), (req,res) => {
  try{
    if(!req.file) return res.status(400).json({ok:false,error:'No file'});
    const db=loadDb();
    const maxOrd=db.docs.reduce((m,d)=>Math.max(m,d.display_order),0);
    db.docs.push({id:db.nextId++, title:req.file.originalname||'Document',
      file_path:'/pdfs/'+req.file.filename, display_order:maxOrd+1,
      duration_seconds:20, is_active:true, uploaded_at:new Date().toISOString()});
    saveDb(db); res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.patch('/api/docs/:id', requireAdmin, (req,res) => {
  try{
    const db=loadDb(), doc=db.docs.find(d=>d.id===parseInt(req.params.id));
    if(!doc) return res.status(404).json({ok:false});
    const b=req.body;
    if(b.display_order!==undefined) doc.display_order=parseInt(b.display_order);
    if(b.duration_seconds!==undefined) doc.duration_seconds=Math.max(1,parseInt(b.duration_seconds));
    if(b.is_active!==undefined) doc.is_active=!!b.is_active;
    if(b.title!==undefined) doc.title=b.title;
    saveDb(db); res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.delete('/api/docs/:id', requireAdmin, (req,res) => {
  try{
    const db=loadDb(), idx=db.docs.findIndex(d=>d.id===parseInt(req.params.id));
    if(idx===-1) return res.status(404).json({ok:false});
    try{ fs.unlinkSync(path.join(__dirname,'public',db.docs[idx].file_path)); }catch{}
    db.docs.splice(idx,1); saveDb(db); res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── Logo API ──────────────────────────────────────────────────────────────────
app.get('/api/logo', (_,res) => {
  if(fs.existsSync(LOGO_FILE)){ res.setHeader('Cache-Control','no-cache,no-store'); res.sendFile(LOGO_FILE); }
  else res.status(404).json({error:'No logo'});
});

app.post('/api/logo', requireAdmin, logoUpload.single('logo'), (req,res) => {
  try{
    if(!req.file) return res.status(400).json({ok:false,error:'No file'});
    const tmp=path.join(LOGO_DIR, req.file.filename);
    if(fs.existsSync(LOGO_FILE)) fs.unlinkSync(LOGO_FILE);
    fs.renameSync(tmp, LOGO_FILE);
    res.json({ok:true});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🕍  Shul Display Board`);
  console.log(`   Display: http://localhost:${PORT}/display  (pw: ${DISPLAY_PASS})`);
  console.log(`   Admin:   http://localhost:${PORT}/admin   (pw: ${ADMIN_PASS})\n`);
});
