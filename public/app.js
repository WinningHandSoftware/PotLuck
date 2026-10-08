/* Potluck sign-up: browser app. Talks to the server API; state refreshes every 10 seconds. */
(function () {
const { SHIFTS, CATS, TAGS, slug, defaultEvent } = window.POTLUCK;

const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
function tokens() { try { return JSON.parse(store.get('potluck-tokens') || '{}'); } catch (e) { return {}; } }
function setToken(id, t) { const m = tokens(); if (t) m[id] = t; else delete m[id]; store.set('potluck-tokens', JSON.stringify(m)); }

const S = {
  event: null, claims: [], loaded: false, offline: false, isAdmin: false,
  shift: store.get('potluck-shift') || 'graveyard',
  view: location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'sheet',
  filter: null, dept: null, confirmId: null, claimCtx: null, hostAddCat: null, loginErr: '',
  a: { q: '', shift: '', dept: '', cat: '', sort: 'createdAt', dir: 'desc' }
};
if (!SHIFTS.some(s => s.id === S.shift)) S.shift = 'graveyard';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canManage = () => S.isAdmin;
const mine = c => !!tokens()[c.id];
const ev = () => S.event || defaultEvent();
const shiftOf = id => SHIFTS.find(s => s.id === id);
const catOf = id => CATS.find(c => c.id === id) || CATS[1];
const normDept = d => (d || '').trim();
const spill = id => { const s = shiftOf(id); return s ? `<span class="spill sh-${s.id}">${s.label}</span>` : '<span class="muted">–</span>'; };

function fmtDate(d) { if (!d) return ''; const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function fmtStamp(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function showText(title, text) { $('sendTitle').textContent = title; $('sendHelp').hidden = true; $('sendMsg').textContent = text; if (!$('sendDlg').open) $('sendDlg').showModal(); const r = document.createRange(); r.selectNodeContents($('sendMsg')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { showText('Copy this text', text); } }

/* ---------------- API ---------------- */
async function api(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error(data.error || 'Something went wrong. Try again.'); err.status = res.status; throw err; }
  return data;
}
async function refresh() {
  try {
    const d = await api('GET', '/api/state');
    S.event = d.event; S.claims = d.claims; S.isAdmin = !!d.admin; S.url = d.url || location.origin + '/'; S.loaded = true; S.offline = false;
  } catch (e) { S.offline = true; S.loaded = true; }
  render();
}
async function saveEvent(patch) { const d = await api('PUT', '/api/event', { ...ev(), ...patch }); S.event = d.event; render(); }
const editHeaders = id => { const t = tokens()[id]; return t ? { 'X-Edit-Token': t } : {}; };

function model(shift) {
  const E = ev(); const items = (E.items || []).map(i => ({ ...i, qty: Math.max(1, +i.qty || 1) })); const ids = new Set(items.map(i => i.id));
  const claims = S.claims.filter(c => c.shift === shift);
  const byItem = {}; items.forEach(i => byItem[i.id] = []); const extras = {}; CATS.forEach(c => extras[c.id] = []);
  claims.forEach(c => { if (c.itemId && ids.has(c.itemId)) byItem[c.itemId].push(c); else (extras[c.category] || extras.sides).push(c); });
  const depts = {}; claims.forEach(c => { const d = normDept(c.dept) || 'No department'; depts[d] = (depts[d] || 0) + 1; });
  const slots = items.reduce((a, i) => a + i.qty, 0), filled = items.reduce((a, i) => a + Math.min(i.qty, byItem[i.id].length), 0);
  return { E, items, claims, byItem, extras, depts, slots, filled };
}
function allDepts() { const set = new Set((ev().departments || []).map(normDept).filter(Boolean)); S.claims.forEach(c => { if (normDept(c.dept)) set.add(normDept(c.dept)); }); return [...set]; }

/* ---------------- Sign-up sheet ---------------- */
function claimLine(c) {
  const own = mine(c); const canDel = own || canManage();
  let acts = '';
  if (canDel) acts = S.confirmId === c.id
    ? `<span class="cacts"><span class="muted" style="font-size:.85rem">Take this off?</span><button class="ghost" data-act="cancel-del">Keep</button><button class="ghost danger" data-act="do-del" data-id="${c.id}">Take off</button></span>`
    : `<span class="cacts"><button class="ghost" data-act="edit-claim" data-id="${c.id}">Edit</button><button class="ghost" data-act="ask-del" data-id="${c.id}">${own ? 'Cancel mine' : 'Remove'}</button></span>`;
  return `<li class="claim"><b>${esc(c.name)}</b>${own ? '<span class="muted">(you)</span>' : ''}${normDept(c.dept) ? `<span class="dtag">${esc(c.dept)}</span>` : ''}${c.detail ? `<span class="detail">${esc(c.detail)}</span>` : ''}${c.serves ? `<span class="detail">· serves ${esc(c.serves)}</span>` : ''}${(c.tags || []).map(t => `<span class="tag ${t === 'Has nuts' || t === 'Spicy' ? 'warn' : ''}">${esc(t)}</span>`).join('')}${c.recipe ? `<button class="rbtn" data-act="recipe" data-id="${c.id}">Recipe / deal</button>` : ''}${acts}</li>`;
}
function dimmed(list) {
  if (S.dept && !list.some(c => (normDept(c.dept) || 'No department') === S.dept)) return true;
  if (S.filter && !list.some(c => (c.tags || []).includes(S.filter))) return true;
  return false;
}
function itemCard(i, list) {
  const n = list.length, q = i.qty, full = n >= q;
  const dots = q <= 8 ? Array.from({ length: q }, (_, k) => `<span class="slot ${k < n ? 'on' : ''}"></span>`).join('') : '';
  return `<li class="item ${full ? 'full' : ''} ${dimmed(list) ? 'dim' : ''}">
    <div class="item-top"><span class="item-label">${full ? '<span class="check" aria-hidden="true">✓</span>' : ''}<span class="txt">${esc(i.label)}</span></span>
      <span class="slots" aria-label="${n} of ${q} claimed">${dots}<span class="slotnum">${n}/${q}</span></span></div>
    ${n ? `<ul class="claims">${list.map(claimLine).join('')}</ul>` : ''}
    ${(!full || canManage()) ? `<div class="item-bottom">${!full ? `<button class="primary bring" data-act="claim-item" data-id="${esc(i.id)}">${q === 1 ? "I'll bring it" : q - n === 1 ? 'Take the last one' : "I'll bring one"}</button>` : '<span></span>'}
      ${canManage() ? `<span class="host-q"><button class="ghost" data-act="qty" data-d="-1" data-id="${esc(i.id)}" aria-label="Need one fewer ${esc(i.label)}">−</button><span class="slotnum">need ${q}</span><button class="ghost" data-act="qty" data-d="1" data-id="${esc(i.id)}" aria-label="Need one more ${esc(i.label)}">+</button><button class="ghost" data-act="rm-item" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.label)} from the list">✕</button></span>` : ''}</div>` : ''}
  </li>`;
}
function extraCard(c) {
  return `<li class="item full write ${dimmed([c]) ? 'dim' : ''}"><div class="item-top"><span class="item-label"><span class="check" aria-hidden="true">✓</span><span class="txt">${esc(c.dish)}</span></span><span class="slotnum">write-in</span></div><ul class="claims">${claimLine(c)}</ul></li>`;
}

function renderSheet() {
  const M = model(S.shift); const { E, items, byItem, extras, depts, slots, filled, claims } = M;
  const sh = shiftOf(S.shift); const pct = slots ? Math.round(filled / slots * 100) : 0;
  let h = '';
  h += `<section class="hero"><div class="row between"><span class="eyebrow">Thanksgiving · all departments</span>${canManage() ? '<button class="primary" data-act="go-admin">Admin: see all sign-ups</button>' : ''}</div><h1>${esc(E.name || 'Team Thanksgiving Potluck')}</h1>`;
  const facts = []; if (E.date) facts.push(`<span><b>${esc(fmtDate(E.date))}</b>, all three shifts</span>`); if (E.place) facts.push(`<span>at <b>${esc(E.place)}</b></span>`); if (E.host) facts.push(`<span>organized by <b>${esc(E.host)}</b></span>`);
  if (facts.length) h += `<div class="facts">${facts.join('')}</div>`;
  if (E.notes) h += `<div class="note">${esc(E.notes)}</div>`;
  h += `<p class="muted" style="margin:0">Each shift has its own spread. Pick your shift, then tap <b>I'll bring one</b> on a dish that still has open spots.</p>`;
  h += `</section>`;
  if (S.offline) h += `<div class="offline">Can't reach the server right now. The sheet will update when the connection comes back.</div>`;

  h += `<section class="shifts" role="tablist" aria-label="Shift">${SHIFTS.map(s => { const m = model(s.id); return `<button class="shift sh-${s.id}" role="tab" aria-selected="${S.shift === s.id}" data-act="shift" data-s="${s.id}"><span class="sname">${s.label}</span><span class="scount">${m.claims.length} signed up · ${m.slots ? Math.round(m.filled / m.slots * 100) : 0}%</span></button>`; }).join('')}</section>`;

  const left = CATS.map(c => ({ c, n: items.filter(i => i.cat === c.id).reduce((a, i) => a + Math.max(0, i.qty - byItem[i.id].length), 0) })).filter(x => x.n);
  h += `<section class="panel sh-${sh.id}" aria-label="${sh.label} shift progress">
    <div class="row between"><span class="eyebrow" style="color:var(--sc)">${sh.label} shift</span><span class="count">${claims.length} signed up</span></div>
    <div class="row between"><div><span class="big">${filled}</span> <span class="muted">of ${slots} dishes claimed</span></div><span class="count">${pct}%</span></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <div class="chips">${!S.loaded ? '<span class="chip">Loading…</span>' : left.length ? left.map(x => `<span class="chip need">${x.n} ${x.n === 1 ? x.c.one : x.c.many} still needed</span>`).join('') : '<span class="chip done">Every dish is covered for this shift</span>'}</div></section>`;

  const dl = Object.entries(depts).sort((a, b) => b[1] - a[1]);
  if (dl.length) { const max = dl[0][1];
    h += `<section class="panel" aria-label="By department"><div class="row between"><span class="eyebrow">${sh.label} by department</span>${S.dept ? `<button class="ghost" data-act="dept" data-d="">Show all</button>` : '<span class="help">Tap one to highlight its dishes</span>'}</div><ul class="depts">${dl.map(([d, n]) => `<li><button class="dept" data-act="dept" data-d="${esc(d)}" aria-pressed="${S.dept === d}"><span class="dname">${esc(d)}</span><span class="dbar"><i style="width:${Math.round(n / max * 100)}%"></i></span><span class="dnum">${n}</span></button></li>`).join('')}</ul></section>`; }

  const tagCounts = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Halal'].map(t => [t, claims.filter(c => (c.tags || []).includes(t)).length]).filter(x => x[1]);
  if (tagCounts.length) h += `<section class="row"><span class="eyebrow">Only show what's</span><div class="chips">${tagCounts.map(([t, n]) => `<button class="chip" data-act="filter" data-tag="${esc(t)}" aria-pressed="${S.filter === t}">${esc(t)} · ${n}</button>`).join('')}</div></section>`;

  CATS.forEach(c => {
    const ci = items.filter(i => i.cat === c.id); const ex = extras[c.id];
    const need = ci.reduce((a, i) => a + i.qty, 0), got = ci.reduce((a, i) => a + Math.min(i.qty, byItem[i.id].length), 0);
    h += `<section class="cat" aria-labelledby="h-${c.id}"><div class="cat-head"><h2 id="h-${c.id}">${c.label}</h2><span class="count ${need && got === need ? 'full' : ''}">${need ? `${got} / ${need}` : ''}${ex.length ? ` +${ex.length}` : ''}</span></div><ul class="list">`;
    ci.filter(i => byItem[i.id].length < i.qty).forEach(i => h += itemCard(i, byItem[i.id]));
    ci.filter(i => byItem[i.id].length >= i.qty).forEach(i => h += itemCard(i, byItem[i.id]));
    ex.forEach(x => h += extraCard(x));
    h += `<li><button class="add-own" data-act="claim-own" data-cat="${c.id}"><span class="plus">+</span><span>Add your own ${c.one}</span></button></li>`;
    if (canManage()) h += S.hostAddCat === c.id
      ? `<li><form class="host-add" data-cat="${c.id}"><input id="ha-${c.id}" maxlength="50" placeholder="New ${c.one} for the list" aria-label="New dish for ${c.label}"><input id="hq-${c.id}" type="number" min="1" max="50" value="2" aria-label="How many needed per shift"><button class="primary" type="submit">Add</button><button type="button" data-act="host-add-cancel">Cancel</button></form></li>`
      : `<li><button class="ghost" data-act="host-add" data-cat="${c.id}">Organizer: add a dish to the ${c.label.toLowerCase()} list</button></li>`;
    h += `</ul></section>`;
  });
  h += `<footer class="foot"><span class="muted" style="font-size:.88rem">Updates every few seconds as people sign up.</span><button data-act="copy-shift">Copy ${sh.label} summary</button></footer>`;
  return h;
}

/* ---------------- Admin ---------------- */
function adminRows() {
  const A = S.a; const q = A.q.trim().toLowerCase(); const ids = new Set((ev().items || []).map(i => i.id));
  let rows = S.claims.map(c => ({ ...c, dept: normDept(c.dept), cat: catOf(c.category).label, write: !c.itemId || !ids.has(c.itemId) }));
  if (A.shift) rows = rows.filter(r => r.shift === A.shift);
  if (A.dept) rows = rows.filter(r => (r.dept || 'No department') === A.dept);
  if (A.cat) rows = rows.filter(r => r.category === A.cat);
  if (q) rows = rows.filter(r => [r.name, r.dept, r.dish, r.detail, (r.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
  const key = A.sort, dir = A.dir === 'asc' ? 1 : -1;
  const shiftIdx = s => SHIFTS.findIndex(x => x.id === s);
  rows.sort((a, b) => { let x = a[key], y = b[key]; if (key === 'shift') { x = shiftIdx(x); y = shiftIdx(y); } if (typeof x === 'string' || typeof y === 'string') { x = (x || '').toLowerCase(); y = (y || '').toLowerCase(); } return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  return rows;
}
function renderLogin() {
  return `<section class="hero"><div class="row between"><span class="eyebrow">Admin</span><button data-act="go-sheet">← Back to sign-up sheet</button></div><h1>Organizer login</h1>
    <form class="login" id="loginForm"><div class="field"><label for="l-pw">Admin password</label><input id="l-pw" type="password" autocomplete="current-password" required></div>
    ${S.loginErr ? `<p class="err">${esc(S.loginErr)}</p>` : ''}<div class="row"><button class="primary" type="submit">Log in</button></div>
    <p class="help">This is the ADMIN_PASSWORD set on the server. You'll stay logged in on this device for 30 days.</p></form></section>`;
}
function renderAdmin() {
  if (!S.loaded) return `<section class="hero"><h1>Loading…</h1></section>`;
  if (!canManage()) return renderLogin();
  const A = S.a; const rows = adminRows();
  const people = new Set(S.claims.map(c => c.name.toLowerCase() + '|' + normDept(c.dept).toLowerCase())).size;
  const deptSet = [...new Set(S.claims.map(c => normDept(c.dept) || 'No department'))].sort();
  let h = `<section class="hero"><div class="row between"><span class="eyebrow">Admin · ${esc(ev().name || 'Potluck')}</span><div class="row"><button data-act="go-sheet">← Sign-up sheet</button><button class="ghost" data-act="logout">Log out</button></div></div><h1>Who's bringing what</h1></section>`;
  const E = ev(); const depts = E.departments || [];
  h += `<section class="panel details"><div class="row between"><span class="eyebrow">Event details</span><button class="primary" data-act="edit-event">Edit date, place & departments</button></div>
    <dl class="dl">
      <div><dt>Event</dt><dd>${esc(E.name || '–')}</dd></div>
      <div><dt>Date</dt><dd>${E.date ? esc(fmtDate(E.date)) : '<span class="muted">Not set yet</span>'}</dd></div>
      <div><dt>Where</dt><dd>${E.place ? esc(E.place) : '<span class="muted">Not set yet</span>'}</dd></div>
      <div><dt>Organizer</dt><dd>${E.host ? esc(E.host) : '<span class="muted">Not set yet</span>'}</dd></div>
      <div class="wide"><dt>Departments (${depts.length})</dt><dd>${depts.length ? depts.map(esc).join(', ') : '<span class="muted">None yet</span>'}</dd></div>
      ${E.notes ? `<div class="wide"><dt>Note for everyone</dt><dd>${esc(E.notes)}</dd></div>` : ''}
    </dl></section>`;
  const url = S.url || location.origin + '/';
  h += `<section class="panel share"><div class="qrbox"><img src="/qr.svg" alt="QR code that opens the potluck sign-up sheet" width="168" height="168"></div>
    <div class="share-text"><span class="eyebrow">Share the sign-up sheet</span><h2>Scan to sign up</h2>
      <p class="muted" style="margin:0">Post it in the break room or send the link in the group chat. It opens the sign-up sheet, not this admin page.</p>
      <div class="share-url">${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>
      <div class="row"><button data-act="copy-link">Copy link</button><a class="btn" href="/qr.png?size=1200&download=1" download="potluck-signup-qr.png">Download QR</a><a class="btn primary" href="/flyer" target="_blank" rel="noopener">Print flyer</a></div></div></section>`;
  h += `<section class="panel"><div class="stats">
    <div class="stat"><span class="big">${S.claims.length}</span><span>dishes signed up</span></div>
    <div class="stat"><span class="big">${people}</span><span>people</span></div>
    ${SHIFTS.map(s => { const m = model(s.id); return `<div class="stat sh-${s.id}"><span class="big" style="color:var(--sc)">${m.claims.length}</span><span>${s.label} · ${m.filled}/${m.slots} covered</span></div>`; }).join('')}
  </div></section>`;
  h += `<section class="panel"><span class="eyebrow">Still needed, by shift</span><div class="gaps">${SHIFTS.map(s => { const m = model(s.id); const open = m.items.map(i => ({ i, n: i.qty - m.byItem[i.id].length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    return `<div class="gap sh-${s.id}"><h3>${s.label}</h3>${open.length ? `<ul>${open.slice(0, 8).map(x => `<li><span>${esc(x.i.label)}</span><span>${x.n} more</span></li>`).join('')}</ul>${open.length > 8 ? `<span class="help">+ ${open.length - 8} more dishes</span>` : ''}` : '<span class="chip done" style="align-self:flex-start">All covered</span>'}</div>`; }).join('')}</div></section>`;
  h += `<section class="adminbar"><div class="filters">
    <input class="search" id="a-q" type="search" placeholder="Search name, dish, department" value="${esc(A.q)}" aria-label="Search sign-ups">
    <select id="a-shift" aria-label="Shift"><option value="">All shifts</option>${SHIFTS.map(s => `<option value="${s.id}" ${A.shift === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
    <select id="a-dept" aria-label="Department"><option value="">All departments</option>${deptSet.map(d => `<option ${A.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
    <select id="a-cat" aria-label="Category"><option value="">All categories</option>${CATS.map(c => `<option value="${c.id}" ${A.cat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
  </div><div class="row between"><span class="count">Showing ${rows.length} of ${S.claims.length}</span><div class="row"><button data-act="copy-roster">Copy list</button><a class="primary" href="/api/admin/export.csv" style="font:600 .92rem/1 var(--f-body);border-radius:999px;padding:10px 16px;text-decoration:none;background:var(--accent);color:var(--accent-ink)">Download spreadsheet (CSV)</a></div></div></section>`;
  if (!S.claims.length) return h + `<section class="empty"><b>No sign-ups yet</b><span class="muted">When people claim a dish on the sign-up sheet, they show up here with their shift, department and what they're bringing.</span></section>`;
  const col = (k, l) => `<th scope="col"><button data-act="sort" data-k="${k}">${l}${A.sort === k ? (A.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`;
  h += `<div class="tablewrap"><table><thead><tr>${col('name', 'Name')}${col('dept', 'Department')}${col('shift', 'Shift')}${col('dish', 'Bringing')}${col('cat', 'Category')}<th scope="col">Notes</th>${col('createdAt', 'Signed up')}<th scope="col"><span style="position:absolute;left:-9999px">Actions</span></th></tr></thead><tbody>`;
  rows.forEach(r => {
    const notes = [r.detail ? esc(r.detail) : '', r.serves ? `serves ${esc(r.serves)}` : '', (r.tags || []).map(t => `<span class="tag ${t === 'Has nuts' || t === 'Spicy' ? 'warn' : ''}">${esc(t)}</span>`).join(' '), r.recipe ? `<button class="rbtn" data-act="recipe" data-id="${r.id}">Recipe / deal</button>` : ''].filter(Boolean).join(' · ');
    h += `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.dept || '–')}</td><td>${spill(r.shift)}</td><td>${esc(r.dish)}${r.write ? ' <span class="sub">(write-in)</span>' : ''}</td><td>${esc(r.cat)}</td><td>${notes || '<span class="sub">–</span>'}</td><td class="num">${esc(fmtStamp(r.createdAt))}</td>
      <td style="white-space:nowrap">${S.confirmId === r.id ? `<button class="ghost danger" data-act="do-del" data-id="${r.id}">Confirm remove</button><button class="ghost" data-act="cancel-del">Keep</button>` : `<button class="ghost" data-act="edit-claim" data-id="${r.id}">Edit</button><button class="ghost" data-act="ask-del" data-id="${r.id}">Remove</button>`}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

/* ---------------- Render ---------------- */
function render() {
  if (document.querySelector('dialog[open]') && S._skipWhileDialog) return;
  const app = $('app');
  const ae = document.activeElement; const keep = ae && ae.id && app.contains(ae) ? ae.id : null;
  const selStart = keep && ae.selectionStart;
  app.className = 'wrap' + (S.view === 'admin' ? ' wide' : '');
  app.innerHTML = S.view === 'admin' ? renderAdmin() : renderSheet();
  $('deptList').innerHTML = allDepts().map(d => `<option value="${esc(d)}"></option>`).join('');
  if (S.hostAddCat && S.view === 'sheet') { const i = $('ha-' + S.hostAddCat); if (i && keep !== 'hq-' + S.hostAddCat) i.focus(); }
  if (keep && $(keep)) { const el = $(keep); el.focus(); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (e) {} }
}

/* ---------------- Claim dialog ---------------- */
function findCtx(ctx) {
  const items = ev().items || [];
  const edit = ctx.editId ? S.claims.find(c => c.id === ctx.editId) : null;
  const item = ctx.itemId ? items.find(i => i.id === ctx.itemId) : (edit && edit.itemId ? items.find(i => i.id === edit.itemId) : null);
  return { edit, item };
}
function openClaim(ctx) {
  S.claimCtx = ctx; const { edit, item } = findCtx(ctx); const fixed = !!item;
  $('c-cat').innerHTML = CATS.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('c-tags').innerHTML = TAGS.map((t, i) => `<label for="c-tag-${i}"><input type="checkbox" id="c-tag-${i}" value="${esc(t)}">${esc(t)}</label>`).join('');
  const sh = edit ? edit.shift : S.shift;
  $('c-shift').innerHTML = SHIFTS.map(s => `<label class="sh-${s.id}" for="c-sh-${s.id}"><input type="radio" name="c-shift" id="c-sh-${s.id}" value="${s.id}" ${sh === s.id ? 'checked' : ''}>${s.label}</label>`).join('');
  $('fixedWrap').hidden = !fixed; $('dishWrap').hidden = fixed; $('catWrap').hidden = fixed;
  $('claimTitle').textContent = fixed ? item.label : '';
  $('claimEyebrow').textContent = edit ? 'Edit sign-up' : "I'll bring";
  $('c-dish').value = edit && !fixed ? edit.dish : '';
  $('c-cat').value = edit ? edit.category : (item ? item.cat : (ctx.cat || 'sides'));
  $('c-name').value = edit ? edit.name : (store.get('potluck-name') || '');
  $('c-dept').value = edit ? (edit.dept || '') : (store.get('potluck-dept') || '');
  $('c-detail').value = edit?.detail || ''; $('c-serves').value = edit?.serves || ''; $('c-recipe').value = edit?.recipe || '';
  (edit?.tags || []).forEach(t => { const i = TAGS.indexOf(t); if (i >= 0) $('c-tag-' + i).checked = true; });
  $('c-submit').textContent = edit ? 'Save changes' : 'Count me in';
  $('c-err').hidden = true; $('c-submit').disabled = false;
  $('claimDlg').showModal();
  (!fixed ? $('c-dish') : !$('c-name').value ? $('c-name') : !$('c-dept').value ? $('c-dept') : $('c-detail')).focus();
}
$('claimForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { edit, item } = findCtx(S.claimCtx || {});
  const name = $('c-name').value.trim(), dept = $('c-dept').value.trim();
  const shift = ($('claimForm').querySelector('input[name="c-shift"]:checked') || {}).value;
  const dish = item ? item.label : $('c-dish').value.trim(), category = item ? item.cat : $('c-cat').value;
  const detail = $('c-detail').value.trim(), serves = parseInt($('c-serves').value, 10), recipe = $('c-recipe').value.trim();
  const tags = [...$('c-tags').querySelectorAll('input:checked')].map(i => i.value);
  const err = $('c-err'); const fail = m => { err.textContent = m; err.hidden = false; };
  if (!dish) return fail('Add what you\'re bringing, even if it\'s just "a bag of ice".');
  if (!shift) return fail('Pick the shift you\'re bringing food for.');
  if (!name) return fail('Add your name so everyone knows who\'s bringing it.');
  if (!dept) return fail('Add your department so the organizer can see which teams are covered.');
  if (!edit || mine(edit)) { store.set('potluck-name', name); store.set('potluck-dept', dept); }
  const body = { name, dept, shift, dish, category, detail, recipe, tags, serves: serves > 0 ? serves : null, itemId: item ? item.id : null };
  const btn = $('c-submit'); btn.disabled = true;
  try {
    if (edit) { await api('PATCH', '/api/claims/' + edit.id, body, editHeaders(edit.id)); toast('Saved'); }
    else {
      const d = await api('POST', '/api/claims', body); setToken(d.claim.id, d.editToken);
      toast(`You're down for ${d.claim.dish} on ${shiftOf(shift).label}. Thank you!`);
      if (shift !== S.shift) { S.shift = shift; store.set('potluck-shift', shift); }
    }
    $('claimDlg').close(); await refresh();
  } catch (ex) { fail(ex.message); if (ex.status === 409) refresh(); }
  finally { btn.disabled = false; }
});
$('c-cancel').onclick = () => $('claimDlg').close();
$('s-close').onclick = () => $('sendDlg').close();

/* ---------------- Recipe viewer ---------------- */
function linkify(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`);
}
function openRecipe(id) {
  const c = S.claims.find(x => x.id === id); if (!c || !c.recipe) return;
  $('recipeTitle').textContent = c.dish;
  $('recipeWho').textContent = `From ${c.name}${c.dept ? ' · ' + c.dept : ''} · ${shiftOf(c.shift)?.label || ''} shift`;
  $('recipeBody').innerHTML = linkify(c.recipe);
  $('recipeDlg').dataset.text = `${c.dish} (from ${c.name})\n\n${c.recipe}`;
  $('recipeDlg').showModal(); $('r-close').focus();
}
$('r-close').onclick = () => $('recipeDlg').close();
$('r-copy').onclick = () => { $('recipeDlg').close(); copy($('recipeDlg').dataset.text || ''); };
$('s-copy').onclick = () => copy($('sendMsg').textContent);

/* ---------------- Event details ---------------- */
function openEvent() {
  const E = ev();
  $('e-name').value = E.name || ''; $('e-date').value = E.date || ''; $('e-place').value = E.place || '';
  $('e-host').value = E.host || store.get('potluck-name') || ''; $('e-depts').value = (E.departments || []).join(', '); $('e-notes').value = E.notes || '';
  $('e-err').hidden = true; $('eventDlg').showModal(); $('e-name').focus();
}
$('eventForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('e-name').value.trim();
  if (!name) { $('e-err').textContent = 'Give the potluck a name.'; $('e-err').hidden = false; return; }
  const departments = [...new Set($('e-depts').value.split(/[,\n]/).map(normDept).filter(Boolean))];
  try { await saveEvent({ name, date: $('e-date').value, place: $('e-place').value.trim(), host: $('e-host').value.trim(), departments, notes: $('e-notes').value.trim() }); $('eventDlg').close(); toast('Details saved'); }
  catch (ex) { $('e-err').textContent = ex.message; $('e-err').hidden = false; }
});
$('e-cancel').onclick = () => $('eventDlg').close();

/* ---------------- Actions ---------------- */
function go(view) { S.view = view; S.confirmId = null; history.pushState(null, '', view === 'admin' ? '/admin' : '/'); render(); scrollTo(0, 0); }
addEventListener('popstate', () => { S.view = location.pathname.replace(/\/+$/, '') === '/admin' ? 'admin' : 'sheet'; render(); });

$('app').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id; const E = ev();
  try {
    if (act === 'claim-item') openClaim({ itemId: id });
    else if (act === 'claim-own') openClaim({ cat: b.dataset.cat });
    else if (act === 'edit-claim') openClaim({ editId: id });
    else if (act === 'edit-event') openEvent();
    else if (act === 'recipe') openRecipe(id);
    else if (act === 'go-admin') go('admin');
    else if (act === 'go-sheet') go('sheet');
    else if (act === 'copy-link') copy(S.url || location.origin + '/');
    else if (act === 'logout') { await api('POST', '/api/admin/logout'); S.isAdmin = false; render(); }
    else if (act === 'shift') { S.shift = b.dataset.s; S.dept = null; S.filter = null; store.set('potluck-shift', S.shift); render(); }
    else if (act === 'filter') { S.filter = S.filter === b.dataset.tag ? null : b.dataset.tag; render(); }
    else if (act === 'dept') { const d = b.dataset.d; S.dept = !d || S.dept === d ? null : d; render(); }
    else if (act === 'ask-del') { S.confirmId = id; render(); }
    else if (act === 'cancel-del') { S.confirmId = null; render(); }
    else if (act === 'do-del') { S.confirmId = null; await api('DELETE', '/api/claims/' + id, null, editHeaders(id)); setToken(id, null); toast('Removed'); await refresh(); }
    else if (act === 'qty') await saveEvent({ items: (E.items || []).map(i => i.id === id ? { ...i, qty: Math.max(1, Math.min(50, (+i.qty || 1) + (+b.dataset.d))) } : i) });
    else if (act === 'rm-item') { const it = (E.items || []).find(i => i.id === id); await saveEvent({ items: (E.items || []).filter(i => i.id !== id) }); toast(`Removed ${it ? it.label : 'dish'}`); }
    else if (act === 'host-add') { S.hostAddCat = b.dataset.cat; render(); }
    else if (act === 'host-add-cancel') { S.hostAddCat = null; render(); }
    else if (act === 'sort') { const k = b.dataset.k; if (S.a.sort === k) S.a.dir = S.a.dir === 'asc' ? 'desc' : 'asc'; else { S.a.sort = k; S.a.dir = k === 'createdAt' ? 'desc' : 'asc'; } render(); }
    else if (act === 'copy-roster') {
      const rows = adminRows(); let t = `${E.name || 'Potluck'} – sign-ups\n`;
      SHIFTS.forEach(s => { const r = rows.filter(x => x.shift === s.id); if (!r.length) return; t += `\n${s.label.toUpperCase()} (${r.length})\n`; r.forEach(x => t += `• ${x.name}${x.dept ? ' (' + x.dept + ')' : ''}: ${x.dish}${x.detail ? ' – ' + x.detail : ''}\n`); });
      copy(t.trim());
    }
    else if (act === 'copy-shift') {
      const m = model(S.shift); const sh = shiftOf(S.shift);
      let t = `${E.name || 'Potluck'} – ${sh.label} shift${E.date ? '\n' + fmtDate(E.date) : ''}${E.place ? '\n' + E.place : ''}\n`;
      const open = m.items.filter(i => m.byItem[i.id].length < i.qty);
      if (open.length) { t += `\nSTILL NEEDED\n`; open.forEach(i => t += `• ${i.label} (${i.qty - m.byItem[i.id].length} more)\n`); }
      CATS.forEach(c => { const ci = m.items.filter(i => i.cat === c.id && m.byItem[i.id].length); const ex = m.extras[c.id]; if (!ci.length && !ex.length) return;
        t += `\n${c.label.toUpperCase()}\n`; ci.forEach(i => t += `✅ ${i.label}: ${m.byItem[i.id].map(x => x.name).join(', ')}\n`); ex.forEach(x => t += `✅ ${x.dish}: ${x.name}\n`); });
      t += `\nSign up here: ${location.origin}`; copy(t.trim());
    }
  } catch (ex) { toast(ex.message); }
});
$('app').addEventListener('input', e => { if (e.target.id === 'a-q') { S.a.q = e.target.value; render(); } });
$('app').addEventListener('change', e => { const m = { 'a-shift': 'shift', 'a-dept': 'dept', 'a-cat': 'cat' }[e.target.id]; if (m) { S.a[m] = e.target.value; render(); } });
$('app').addEventListener('submit', async e => {
  if (e.target.id === 'loginForm') {
    e.preventDefault();
    try { await api('POST', '/api/admin/login', { password: $('l-pw').value }); S.loginErr = ''; await refresh(); toast('Logged in'); }
    catch (ex) { S.loginErr = ex.message; render(); }
    return;
  }
  const f = e.target.closest('.host-add'); if (!f) return; e.preventDefault();
  const cat = f.dataset.cat; const label = $('ha-' + cat).value.trim(); const qty = Math.max(1, Math.min(50, parseInt($('hq-' + cat).value, 10) || 1)); if (!label) return;
  const E = ev(); const id = 'own-' + slug(label) + '-' + Date.now().toString(36);
  try { await saveEvent({ items: [...(E.items || []), { id, label, cat, qty }] }); S.hostAddCat = null; render(); toast(`Added ${label}`); } catch (ex) { toast(ex.message); }
});

/* ---------------- Boot ---------------- */
render();
refresh();
setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
})();
