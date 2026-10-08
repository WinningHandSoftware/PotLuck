'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const { SHIFTS, CATS, TAGS, defaultEvent } = require('./public/shared');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://potluck-signup-8oyh.onrender.com/').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('potluck:' + ADMIN_PASSWORD).digest('hex');

if (!DATABASE_URL) { console.error('Missing DATABASE_URL. Add your Supabase connection string.'); process.exit(1); }
if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set, so nobody can open the admin page.');

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL) || /host=\/|localhost/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS potluck_event (
      id INT PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT one_row CHECK (id = 1)
    );
    CREATE TABLE IF NOT EXISTS potluck_claims (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      dept TEXT NOT NULL,
      shift TEXT NOT NULL,
      dish TEXT NOT NULL,
      category TEXT NOT NULL,
      item_id TEXT,
      detail TEXT,
      serves INT,
      tags JSONB NOT NULL DEFAULT '[]',
      edit_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS potluck_claims_item_shift ON potluck_claims (item_id, shift);
    ALTER TABLE potluck_claims ADD COLUMN IF NOT EXISTS recipe TEXT;
  `);
  await pool.query(`INSERT INTO potluck_event (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(defaultEvent())]);
}

/* ---------- helpers ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function sign(value) { return value + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function verify(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return safeEq(sign(value), signed) ? value : null;
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isAdmin(req) {
  const v = verify(cookies(req).potluck_admin);
  if (!v) return false;
  const exp = Number(v.split(':')[1]);
  return v.startsWith('admin:') && exp > Date.now();
}
function requireAdmin(req, res, next) { if (isAdmin(req)) return next(); res.status(401).json({ error: 'Log in as the organizer first.' }); }

// Tiny in-memory rate limiter (per IP, per bucket).
const hits = new Map();
function limit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + ':' + (req.ip || 'x');
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many tries. Wait a minute and try again.' });
    arr.push(now); hits.set(key, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 600000)) hits.delete(k); }, 600000).unref();

const shiftIds = new Set(SHIFTS.map(s => s.id));
const catIds = new Set(CATS.map(c => c.id));
const tagSet = new Set(TAGS);

function cleanClaim(b) {
  const out = {
    name: str(b.name, 40),
    dept: str(b.dept, 40),
    shift: str(b.shift, 20),
    dish: str(b.dish, 60),
    category: str(b.category, 20),
    item_id: b.itemId ? str(b.itemId, 80) : null,
    detail: str(b.detail, 60) || null,
    recipe: typeof b.recipe === 'string' ? (b.recipe.replace(/\r\n/g, '\n').trim().slice(0, 2000) || null) : null,
    serves: Number.isInteger(+b.serves) && +b.serves > 0 && +b.serves <= 500 ? +b.serves : null,
    tags: Array.isArray(b.tags) ? [...new Set(b.tags.filter(t => tagSet.has(t)))] : []
  };
  if (!out.name) return { error: 'Add your name.' };
  if (!out.dept) return { error: 'Add your department.' };
  if (!shiftIds.has(out.shift)) return { error: 'Pick a shift.' };
  if (!catIds.has(out.category)) out.category = 'sides';
  return { claim: out };
}
function publicClaim(r) {
  return { id: r.id, name: r.name, dept: r.dept, shift: r.shift, dish: r.dish, category: r.category, itemId: r.item_id, detail: r.detail, recipe: r.recipe || null, serves: r.serves, tags: r.tags || [], createdAt: new Date(r.created_at).getTime() };
}
function cleanEvent(b, prev) {
  const items = Array.isArray(b.items) ? b.items.slice(0, 200).map(i => ({
    id: str(i.id, 80), label: str(i.label, 60), cat: catIds.has(i.cat) ? i.cat : 'sides',
    qty: Math.max(1, Math.min(50, parseInt(i.qty, 10) || 1))
  })).filter(i => i.id && i.label) : prev.items;
  const departments = Array.isArray(b.departments) ? [...new Set(b.departments.map(d => str(d, 40)).filter(Boolean))].slice(0, 60) : prev.departments;
  return {
    name: b.name !== undefined ? (str(b.name, 60) || prev.name) : prev.name,
    date: b.date !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '') : prev.date,
    place: b.place !== undefined ? str(b.place, 80) : prev.place,
    host: b.host !== undefined ? str(b.host, 40) : prev.host,
    notes: b.notes !== undefined ? (typeof b.notes === 'string' ? b.notes.trim().slice(0, 300) : '') : prev.notes,
    departments, items
  };
}
async function getEvent(client = pool) {
  const r = await client.query('SELECT data FROM potluck_event WHERE id = 1');
  return r.rows[0] ? r.rows[0].data : defaultEvent();
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/api/state', async (req, res, next) => {
  try {
    const [event, claims] = await Promise.all([getEvent(), pool.query('SELECT * FROM potluck_claims ORDER BY created_at')]);
    res.set('Cache-Control', 'no-store');
    res.json({ event, claims: claims.rows.map(publicClaim), admin: isAdmin(req), url: signupUrl() });
  } catch (e) { next(e); }
});

// Create a sign-up. Checks capacity for preset dishes inside a transaction.
app.post('/api/claims', limit('claim', 20, 60000), async (req, res, next) => {
  const { claim, error } = cleanClaim(req.body || {});
  if (error) return res.status(400).json({ error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ev = (await client.query('SELECT data FROM potluck_event WHERE id = 1 FOR UPDATE')).rows[0].data;
    const item = claim.item_id ? (ev.items || []).find(i => i.id === claim.item_id) : null;
    if (claim.item_id && !item) claim.item_id = null;
    if (item) {
      claim.dish = item.label; claim.category = item.cat;
      const n = (await client.query('SELECT count(*)::int AS n FROM potluck_claims WHERE item_id = $1 AND shift = $2', [item.id, claim.shift])).rows[0].n;
      if (n >= item.qty) { await client.query('ROLLBACK'); return res.status(409).json({ error: `${item.label} is already covered for that shift. Pick another dish or add your own.` }); }
    }
    if (!claim.dish) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Add what you\'re bringing.' }); }
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('hex');
    const r = await client.query(
      `INSERT INTO potluck_claims (id,name,dept,shift,dish,category,item_id,detail,serves,tags,edit_hash,recipe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, claim.name, claim.dept, claim.shift, claim.dish, claim.category, claim.item_id, claim.detail, claim.serves, JSON.stringify(claim.tags), sha(token), claim.recipe]);
    await client.query('COMMIT');
    res.status(201).json({ claim: publicClaim(r.rows[0]), editToken: token });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

async function loadOwned(req, res) {
  const r = await pool.query('SELECT * FROM potluck_claims WHERE id = $1', [String(req.params.id)]).catch(() => ({ rows: [] }));
  const row = r.rows[0];
  if (!row) { res.status(404).json({ error: 'That sign-up no longer exists.' }); return null; }
  const token = req.get('X-Edit-Token') || '';
  if (!isAdmin(req) && !(token && safeEq(sha(token), row.edit_hash))) { res.status(403).json({ error: 'You can only change your own sign-up.' }); return null; }
  return row;
}

app.patch('/api/claims/:id', limit('edit', 30, 60000), async (req, res, next) => {
  try {
    const row = await loadOwned(req, res); if (!row) return;
    const { claim, error } = cleanClaim({ ...publicClaim(row), ...req.body, itemId: row.item_id });
    if (error) return res.status(400).json({ error });
    if (row.item_id) {
      const ev = await getEvent();
      const item = (ev.items || []).find(i => i.id === row.item_id);
      if (item) {
        claim.dish = item.label; claim.category = item.cat;
        if (claim.shift !== row.shift) {
          const n = (await pool.query('SELECT count(*)::int AS n FROM potluck_claims WHERE item_id=$1 AND shift=$2', [item.id, claim.shift])).rows[0].n;
          if (n >= item.qty) return res.status(409).json({ error: `${item.label} is already covered for that shift.` });
        }
      }
    }
    if (!claim.dish) return res.status(400).json({ error: 'Add what you\'re bringing.' });
    const r = await pool.query(
      `UPDATE potluck_claims SET name=$2,dept=$3,shift=$4,dish=$5,category=$6,detail=$7,serves=$8,tags=$9,recipe=$10,updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id, claim.name, claim.dept, claim.shift, claim.dish, claim.category, claim.detail, claim.serves, JSON.stringify(claim.tags), claim.recipe]);
    res.json({ claim: publicClaim(r.rows[0]) });
  } catch (e) { next(e); }
});

app.delete('/api/claims/:id', async (req, res, next) => {
  try {
    const row = await loadOwned(req, res); if (!row) return;
    await pool.query('DELETE FROM potluck_claims WHERE id = $1', [row.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- admin ---------- */
app.post('/api/admin/login', limit('login', 8, 600000), (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (!ADMIN_PASSWORD || !safeEq(sha(pw), sha(ADMIN_PASSWORD))) return res.status(401).json({ error: 'That password is not right.' });
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `potluck_admin=${encodeURIComponent(sign('admin:' + exp))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 24 * 3600}${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'potluck_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

app.put('/api/event', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prev = (await client.query('SELECT data FROM potluck_event WHERE id = 1 FOR UPDATE')).rows[0].data;
    const next_ = cleanEvent(req.body || {}, prev);
    await client.query('UPDATE potluck_event SET data=$1, updated_at=now() WHERE id=1', [JSON.stringify(next_)]);
    await client.query('COMMIT');
    res.json({ event: next_ });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

app.get('/api/admin/export.csv', requireAdmin, async (req, res, next) => {
  try {
    const ev = await getEvent();
    const itemIds = new Set((ev.items || []).map(i => i.id));
    const rows = (await pool.query('SELECT * FROM potluck_claims ORDER BY shift, dept, name')).rows;
    const q = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const shiftLabel = id => (SHIFTS.find(s => s.id === id) || {}).label || id;
    const catLabel = id => (CATS.find(c => c.id === id) || {}).label || id;
    const lines = [['Name', 'Department', 'Shift', 'Bringing', 'Category', 'Details', 'Serves', 'Tags', 'Recipe / deal', 'Write-in', 'Signed up'].join(',')];
    rows.forEach(r => lines.push([r.name, r.dept, shiftLabel(r.shift), r.dish, catLabel(r.category), r.detail, r.serves, (r.tags || []).join('; '), r.recipe, r.item_id && itemIds.has(r.item_id) ? '' : 'Yes', new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })].map(q).join(',')));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="potluck-signups.csv"', 'Cache-Control': 'no-store' });
    res.send('﻿' + lines.join('\r\n'));
  } catch (e) { next(e); }
});

/* ---------- QR code + flyer ---------- */
const signupUrl = () => PUBLIC_URL.endsWith('/') ? PUBLIC_URL : PUBLIC_URL + '/';
const htmlEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qrOpts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1D2A20', light: '#FFFFFF' } };

app.get('/qr.svg', async (req, res, next) => {
  try {
    const svg = await QRCode.toString(signupUrl(), { ...qrOpts, type: 'svg' });
    res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' }).send(svg);
  } catch (e) { next(e); }
});
app.get('/qr.png', async (req, res, next) => {
  try {
    const width = Math.max(200, Math.min(2000, parseInt(req.query.size, 10) || 1024));
    const png = await QRCode.toBuffer(signupUrl(), { ...qrOpts, type: 'png', width });
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' };
    if (req.query.download) headers['Content-Disposition'] = 'attachment; filename="potluck-signup-qr.png"';
    res.set(headers).send(png);
  } catch (e) { next(e); }
});
app.get('/flyer', async (req, res, next) => {
  try {
    const ev = await getEvent();
    const svg = await QRCode.toString(signupUrl(), { ...qrOpts, type: 'svg' });
    let when = '';
    if (ev.date) { const [y, m, d] = ev.date.split('-').map(Number); when = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
    res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(ev.name)} – flyer</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Figtree:wght@500;700&family=DM+Mono:wght@500&display=swap">
<style>
@page{size:letter;margin:0.5in}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1D2A20;font-family:Figtree,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:7.5in;margin:0 auto;padding:32px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:18px}
.cloth{width:100%;height:34px;background-image:linear-gradient(90deg,rgba(47,107,79,.55) 50%,transparent 50%),linear-gradient(rgba(47,107,79,.55) 50%,transparent 50%);background-size:22px 22px;border-radius:6px}
.eyebrow{font:500 14px/1 "DM Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#5F6E62}
h1{font:400 clamp(34px,7vw,56px)/1.02 "Bagel Fat One","Arial Rounded MT Bold",sans-serif;margin:0;text-wrap:balance}
.facts{font-size:20px;font-weight:700}
.facts span{display:block;font-weight:500;color:#5F6E62;font-size:17px}
.qr{width:min(4.2in,80vw);border:3px solid #1D2A20;border-radius:18px;padding:10px;background:#fff}
.qr svg{display:block;width:100%;height:auto}
.scan{font:400 28px/1.1 "Bagel Fat One","Arial Rounded MT Bold",sans-serif}
.how{font-size:17px;max-width:5.6in;line-height:1.45}
.shifts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.shifts b{border:2px solid currentColor;border-radius:999px;padding:6px 14px;font-size:15px}
.url{font:500 15px/1.3 "DM Mono",monospace;color:#2F6B4F;word-break:break-all}
.bar{display:flex;gap:10px;justify-content:center;margin-top:8px}
.bar button,.bar a{font:700 15px Figtree,sans-serif;padding:11px 18px;border-radius:999px;border:2px solid #2F6B4F;background:#2F6B4F;color:#fff;cursor:pointer;text-decoration:none}
.bar a{background:#fff;color:#2F6B4F}
@media print{.bar{display:none}.page{padding:0}}
</style></head><body><div class="page">
<div class="cloth"></div>
<span class="eyebrow">Thanksgiving · all departments · all shifts</span>
<h1>${htmlEsc(ev.name || 'Team Thanksgiving Potluck')}</h1>
${when || ev.place ? `<div class="facts">${htmlEsc(when)}${ev.place ? `<span>${htmlEsc(ev.place)}</span>` : ''}</div>` : ''}
<div class="qr" role="img" aria-label="QR code for the potluck sign-up sheet">${svg}</div>
<div class="scan">Scan to sign up</div>
<p class="how" style="margin:0">Pick your shift, claim a dish that still has open spots, or add your own. Share your recipe or a deal you found while you're at it.</p>
<div class="shifts"><b style="color:#B97B1E">Morning</b><b style="color:#C0583A">Swing</b><b style="color:#3E4C8A">Graveyard</b></div>
<div class="url">${htmlEsc(signupUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>
${ev.host ? `<div class="eyebrow">Questions? Ask ${htmlEsc(ev.host)}</div>` : ''}
<div class="bar"><button onclick="window.print()">Print flyer</button><a href="/admin">Back to admin</a></div>
</div></body></html>`);
  } catch (e) { next(e); }
});

/* ---------- pages ---------- */
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '5m' }));
app.get(['/', '/admin'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});

migrate()
  .then(() => app.listen(PORT, () => console.log(`Potluck sign-up running on port ${PORT}`)))
  .catch(err => { console.error('Could not connect to the database:', err.message); process.exit(1); });
