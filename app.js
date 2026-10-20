"use strict";
/* Our Tax — work trips and tax deductions for two people. Data lives on each phone (IndexedDB), with a shared live copy in Dropbox. */
const APP_ID = "our-tax", BACKUP_VERSION = 1, APP_VERSION = "1.0";

/* ================= storage ================= */
const STORES = ["entries", "files", "meta"];
let _db, _quiet = 0;
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open("our-tax", 1);
  r.onupgradeneeded = () => { const d = r.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); };
  r.onsuccess = () => { _db = r.result; res(_db); }; r.onerror = () => rej(r.error); }); }
function tx(store, mode, fn) { return new Promise((res, rej) => { const t = _db.transaction(store, mode); const os = t.objectStore(store); let out; const r = fn(os); if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
const dbAll = s => tx(s, "readonly", os => os.getAll());
const dbGet = (s, id) => tx(s, "readonly", os => os.get(id));
const DATA_STORES = ["entries", "files"]; // changes to these are sent to Dropbox
const dirtyAfter = s => r => { if (DATA_STORES.includes(s)) markDirty(); return r; };
const dbPut = (s, o) => { if (!_quiet && o && s === "entries") o._t = Date.now(); return tx(s, "readwrite", os => os.put(o)).then(dirtyAfter(s)); }; // _t = when this record last changed (for merging two phones)
const dbDel = (s, id) => { if (!_quiet && DATA_STORES.includes(s)) { S.meta.tomb = S.meta.tomb || {}; S.meta.tomb[id] = Date.now(); } return tx(s, "readwrite", os => os.delete(id)).then(dirtyAfter(s)); };
const uid = p => (p || "x") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= state, settings & helpers ================= */
const S = { entries: [], meta: {}, tab: "home", sheet: null, fy: null, who: null, sumWho: null, rec: { q: "", type: "all", who: "all", removed: false }, urls: {} };
const DEFAULT_RULE = { cpk: true, rate: 0.91, cap: 5000, std: false, stdAmt: 1000, stdCats: ["car", "cat-uniform", "cat-work"], instant: 300 };
const DEFAULT_SETTINGS = {
  people: [{ id: "p-shaun", name: "Shaun" }, { id: "p-lyndsey", name: "Lyndsey" }],
  places: [{ id: "pl-windsor", name: "Windsor Court", km: 46 }, { id: "pl-mtdruitt", name: "Mt Druitt Court", km: 30 }, { id: "pl-blacktown", name: "Blacktown Court", km: 52 }],
  cars: [{ id: "car-yaris", name: "Toyota Yaris", isDefault: true }],
  purposes: ["Hearing", "List", "Bail Court", "Part heard", "Covering", "Court"],
  categories: [{ id: "cat-uniform", name: "Uniform / Laundry" }, { id: "cat-work", name: "Other work-related" }, { id: "cat-union", name: "Union & association fees" },
    { id: "cat-other", name: "Other deductions" }, { id: "cat-agent", name: "Tax agent fees" }, { id: "cat-donation", name: "Donations" }],
  rules: {
    "2025-26": { ...DEFAULT_RULE, rate: 0.88, std: false },
    "2026-27": { ...DEFAULT_RULE, rate: 0.91, std: true }
  },
  accountant: "Positive Tax Solutions", retainYears: 7
};
const SET = () => Object.assign({}, DEFAULT_SETTINGS, S.meta.settings || {});
async function saveSettings(s) { s._t = Date.now(); S.meta.settings = s; await saveMeta(); markDirty(); }
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
const todayISO = () => isoOf(new Date());
const parseISO = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const fmtDate = s => { if (!s) return "—"; const [y, m, d] = String(s).split("-"); return `${+d} ${MON[+m - 1]} ${y}`; };
const fmtDay = s => { if (!s) return "—"; const d = parseISO(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` + (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""); };
const fmtAU = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const money = n => n == null || isNaN(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kmf = n => n == null || isNaN(n) ? "—" : (+n).toLocaleString("en-AU", { maximumFractionDigits: 1 }) + " km";
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
function num(v) { if (v == null) return null; const s = String(v).replace(/[,\s$%]/g, ""); if (s === "") return null; const n = Number(s); return isFinite(n) ? n : null; }
const cents = rate => (rate * 100).toLocaleString("en-AU", { maximumFractionDigits: 1 }) + "c";
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3600); }
const cap1 = t => t ? t[0].toUpperCase() + t.slice(1) : t;

/* tax years run 1 July – 30 June, written like 2026-27 */
function fyOf(iso) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7), s = m >= 7 ? y : y - 1; return `${s}-${p2((s + 1) % 100)}`; }
const fyY = fy => +fy.slice(0, 4);
const fyStart = fy => `${fyY(fy)}-07-01`, fyEnd = fy => `${fyY(fy) + 1}-06-30`;
const fyRange = fy => `1 Jul ${fyY(fy)} – 30 Jun ${fyY(fy) + 1}`;
const nextFy = fy => `${fyY(fy) + 1}-${p2((fyY(fy) + 2) % 100)}`;
const keepUntil = fy => `${fyY(fy) + 1 + (SET().retainYears || 7)}-06-30`;
const inRetention = e => todayISO() <= keepUntil(fyOf(e.date));
function fyList() { const set = new Set([fyOf(todayISO()), ...Object.keys(SET().rules || {}), ...S.entries.map(e => fyOf(e.date))]); return [...set].filter(f => /^\d{4}-\d{2}$/.test(f)).sort().reverse(); }
/* the rules for a tax year; a year with none set borrows the latest earlier year's (and says so) */
function rulesFor(fy) {
  const R = SET().rules || {};
  if (R[fy]) return { ...DEFAULT_RULE, ...R[fy], fy, inherited: false };
  const ks = Object.keys(R).sort(), before = ks.filter(k => k < fy), from = before.length ? before[before.length - 1] : ks[0];
  return { ...DEFAULT_RULE, ...(from ? R[from] : {}), fy, inherited: true, from: from || null };
}
const people = () => SET().people || [];
const pName = id => (people().find(p => p.id === id) || {}).name || "—";
const pIdx = id => Math.max(0, people().findIndex(p => p.id === id));
const av = id => `<span class="av ${pIdx(id) % 2 ? "p1" : ""}" aria-hidden="true">${esc((pName(id) || "?")[0])}</span>`;
const visPlaces = () => (SET().places || []).filter(p => !p.hidden);
const visCars = () => (SET().cars || []).filter(c => !c.hidden);
const visCats = () => (SET().categories || []).filter(c => !c.hidden);
const defCar = () => { const c = visCars(); return c.find(x => x.isDefault) || c[0] || null; };
const catName = id => ((SET().categories || []).find(c => c.id === id) || {}).name;
const expClaim = e => r2((e.amount || 0) * (e.pct == null ? 100 : e.pct) / 100);
const tripClaim = e => { const R = rulesFor(fyOf(e.date)); return R.cpk ? r2((e.km || 0) * R.rate) : 0; };
const live = e => !e.removed;

/* ================= calculations ================= */
/* totals for one tax year, for one person (or everyone when pid is null) */
function calc(fy, pid) {
  const R = rulesFor(fy), set = SET();
  const list = S.entries.filter(e => live(e) && e.date && fyOf(e.date) === fy && (!pid || e.person === pid));
  const trips = list.filter(e => e.type === "trip"), exps = list.filter(e => e.type === "expense");
  const groups = new Map(); // the km cap applies per person, per car
  for (const t of trips) { const k = t.person + "|" + (t.carId || t.car); const g = groups.get(k) || { person: t.person, carId: t.carId, car: t.car || "Car", km: 0, count: 0 }; g.km += t.km || 0; g.count++; groups.set(k, g); }
  const cars = [...groups.values()].map(g => { const claimKm = R.cpk ? Math.min(g.km, R.cap) : 0; return { ...g, km: r2(g.km), claimKm, over: R.cpk && g.km > R.cap, claim: r2(claimKm * R.rate) }; });
  const carClaim = r2(cars.reduce((a, c) => a + c.claim, 0)), km = r2(trips.reduce((a, t) => a + (t.km || 0), 0));
  const places = new Map(); for (const t of trips) { const p = places.get(t.place) || { name: t.place, count: 0, km: 0 }; p.count++; p.km += t.km || 0; places.set(t.place, p); }
  const catIds = [...(set.categories || []).map(c => c.id)]; for (const e of exps) if (!catIds.includes(e.catId)) catIds.push(e.catId);
  const cats = catIds.map(id => { const es = exps.filter(e => e.catId === id); const c = (set.categories || []).find(x => x.id === id); return { id, name: (c && c.name) || (es[0] && es[0].cat) || "Other", hidden: c && c.hidden, count: es.length, claim: r2(es.reduce((a, e) => a + expClaim(e), 0)) }; }).filter(c => !c.hidden || c.count);
  const total = r2(carClaim + cats.reduce((a, c) => a + c.claim, 0));
  const work = r2((R.stdCats.includes("car") ? carClaim : 0) + cats.filter(c => R.stdCats.includes(c.id)).reduce((a, c) => a + c.claim, 0));
  const std = R.std && pid ? { amt: R.stdAmt, work, onTop: r2(total - work), itemise: work > R.stdAmt, diff: r2(Math.abs(R.stdAmt - work)) } : null;
  return { fy, R, trips, exps, cars, carClaim, km, places: [...places.values()].sort((a, b) => b.km - a.km), cats, total, std, count: list.length, sample: list.some(e => e.sample) };
}

/* ================= icons ================= */
const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  chart: svg('<path d="M3 21h18M6 17v-5M11 17V6M16 17v-8M21 17v-3"/>'),
  sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  car: svg('<path d="M3 16v-3l2-5h14l2 5v3a1 1 0 0 1-1 1h-1M5 17H4a1 1 0 0 1-1-1M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  wifi: svg('<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>', 2),
  back: svg('<path d="M15 18l-6-6 6-6"/>', 2),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  doc: svg('<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 2)
};

/* ================= main screens ================= */
function seg(opts, cur, act, extra = "") { return `<div class="seg" role="group" ${extra}>${opts.map(o => `<button type="button" class="${o.v === cur ? "on" : ""}" aria-pressed="${o.v === cur}" data-act="${act}" data-v="${esc(o.v)}">${esc(o.l)}</button>`).join("")}</div>`; }
const peopleOpts = (all, allLabel) => [...people().map(p => ({ v: p.id, l: p.name })), ...(all ? [{ v: "all", l: allLabel || "Both" }] : [])];
function fySelect(id) { const cur = S.fy; return `<div class="field"><label for="${id}" class="xs" style="position:absolute;left:-9999px">Tax year</label><select id="${id}" data-set="fy">${fyList().map(f => `<option value="${f}" ${f === cur ? "selected" : ""}>Tax year ${f}${f === fyOf(todayISO()) ? " · current" : ""}</option>`).join("")}</select></div>`; }

function render() {
  $("#ver").textContent = "v" + APP_VERSION;
  const tabs = [["home", "Home", IC.home], ["records", "Records", IC.list], ["summary", "Summary", IC.chart], ["settings", "Settings", IC.sliders]];
  $("#tabs").innerHTML = tabs.map(([k, l, i]) => `<button type="button" data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${i}${l}</button>`).join("");
  const main = $("#main");
  if (!S.meta.me) main.innerHTML = viewWelcome();
  else main.innerHTML = S.tab === "records" ? viewRecords() : S.tab === "summary" ? viewSummary() : S.tab === "settings" ? viewSettings() : viewHome();
  $(".tabs").hidden = !S.meta.me;
  paintStatus();
}
function viewWelcome() {
  return `<section class="view" style="padding-top:24px"><div class="card"><h2>Welcome to Our Tax</h2>
    <p style="margin:0">Work trips and tax deductions for both of you, kept for ${SET().retainYears} years and shared through Dropbox.</p>
    <div class="flabel">Whose phone is this?</div>
    <div class="duo">${people().map(p => `<button type="button" class="btn outline" data-act="setMe" data-v="${p.id}">${esc(p.name)}</button>`).join("")}</div>
    <p class="small muted" style="margin:0">This only sets who new entries are for by default and who made each change. Both of you see everything.</p></div></section>`;
}
function banners() {
  const m = S.meta, out = [], R = rulesFor(fyOf(todayISO()));
  if (m.conflict) out.push(`<div class="banner bad"><span>Dropbox has a different copy from this phone. Choose which one to keep.</span><button type="button" class="btn sm" data-act="goBackup">Choose</button></div>`);
  else if (!dbxOn() && S.entries.length) out.push(`<div class="banner"><span>These records are only on this phone. Connect Dropbox to keep them safe and share them with the other phone.</span><button type="button" class="btn sm primary" data-act="goBackup">Connect Dropbox</button></div>`);
  else if (dbxOn() && m.syncError) out.push(`<div class="banner bad"><span>${esc(m.syncError)}</span><button type="button" class="btn sm" data-act="goBackup">Open</button></div>`);
  if (R.inherited) out.push(`<div class="banner"><span>No rules set for ${R.fy} yet, so ${R.from || "the defaults"} rules are being used (${cents(R.rate)}/km${R.std ? `, ${money(R.stdAmt)} standard deduction` : ""}). Check them each July.</span><button type="button" class="btn sm" data-act="rulesNew" data-v="${R.fy}">Set ${R.fy}</button></div>`);
  return out.join("");
}
function viewHome() {
  const who = S.who || S.meta.me, pid = who === "all" ? null : who, c = calc(S.fy, pid), R = c.R;
  const recent = S.entries.filter(e => live(e) && fyOf(e.date) === S.fy && (!pid || e.person === pid)).sort(byNewest).slice(0, 5);
  const carCards = R.cpk ? (c.cars.length ? c.cars : [{ car: (defCar() || {}).name || "Car", km: 0, count: 0, claim: 0, claimKm: 0, person: pid }]).map(g => `
    <div class="card"><div class="line"><h3>Car · cents per km</h3><span class="small muted">${esc(g.car)}${!pid ? " · " + esc(pName(g.person)) : ""}</span></div>
      <div class="row" style="align-items:baseline;gap:8px"><span class="kpi">${kmf(g.km)}</span><span class="small muted">of ${R.cap.toLocaleString("en-AU")} km cap</span></div>
      <div class="bar"><i class="${g.over ? "over" : ""}" style="width:${Math.min(100, g.km / R.cap * 100).toFixed(1)}%"></i></div>
      <div class="small" style="color:var(--ink-2)">${g.count} trip${g.count === 1 ? "" : "s"} · <b style="color:var(--ink)">${money(g.claim)}</b> at ${cents(R.rate)}/km${g.over ? ` · <span class="tag bad">over the cap</span>` : ""}</div></div>`).join("")
    : `<div class="note">The cents per km method is switched off for ${S.fy} in Settings › Tax year rules.</div>`;
  const stdCard = c.std ? `<div class="card"><h3>Itemised vs ${money(c.std.amt)} standard</h3>
      <div><div class="line"><span>Itemised work-related</span><b>${money(c.std.work)}</b></div><div class="bar" style="margin-top:4px"><i style="width:${Math.min(100, c.std.work / Math.max(c.std.work, c.std.amt) * 100).toFixed(1)}%"></i></div></div>
      <div><div class="line"><span>Standard deduction</span><b>${money(c.std.amt)}</b></div><div class="bar" style="margin-top:4px"><i class="grey" style="width:${Math.min(100, c.std.amt / Math.max(c.std.work, c.std.amt) * 100).toFixed(1)}%"></i></div></div>
      <div class="small" style="color:var(--ink-2)">${c.std.itemise ? `Itemising is ahead by ${money(c.std.diff)}.` : `Standard is ahead by ${money(c.std.diff)} so far.`} Items not counted toward it (${esc(notCountedNames(R))}) are claimed on top either way.</div></div>` : "";
  return `<section class="view">${banners()}
    ${seg(peopleOpts(true), who, "who")}
    ${fySelect("fyHome")}
    <div class="duo"><button type="button" class="btn primary" data-act="addTrip">${IC.plus}Trip</button><button type="button" class="btn outline" data-act="addExpense">${IC.plus}Expense</button></div>
    ${carCards}${stdCard}
    <div class="card flat"><div class="line"><span>Total deductions so far${pid ? "" : " (both)"}</span><b>${money(c.total)}</b></div></div>
    <div class="sec"><h2 style="font-size:15px">Recent</h2><button type="button" class="btn ghost sm" data-act="tab" data-v="records">See all</button></div>
    ${recent.length ? `<div class="list">${recent.map(liEntry).join("")}</div>` : `<div class="empty">Nothing recorded for ${S.fy} yet. Tap <b>Trip</b> after your next court day.</div>`}
  </section>`;
}
function notCountedNames(R) { const n = visCats().filter(c => !R.stdCats.includes(c.id)).map(c => c.name.toLowerCase()); return n.length ? n.join(", ") : "none"; }
const byNewest = (a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0);
function liEntry(e) {
  const trip = e.type === "trip";
  const title = trip ? `${e.place}${e.purpose ? " · " + e.purpose : ""}` : (e.desc || e.cat || "Expense");
  const sub = trip ? `${fmtDay(e.date)} · ${kmf(e.km)} · ${e.car || ""}` : `${fmtDay(e.date)} · ${e.cat || ""}${e.pct != null && e.pct < 100 ? ` · ${e.pct}% work` : ""}${(e.files || []).length ? " · receipt" : ""}`;
  return `<button type="button" class="li ${e.removed ? "removed" : ""}" data-act="openEntry" data-id="${esc(e.id)}">${av(e.person)}<span class="t"><b>${esc(title)}</b><span>${esc(sub)}${e.removed ? ' <span class="tag bad">removed</span>' : ""}${e.sample ? ' <span class="tag">sample</span>' : ""}</span></span><span class="amt">${money(trip ? tripClaim(e) : expClaim(e))}</span></button>`;
}
function recFiltered() {
  const q = S.rec.q.trim().toLowerCase();
  return S.entries.filter(e => fyOf(e.date) === S.fy && (S.rec.removed || live(e)) && (S.rec.type === "all" || e.type === S.rec.type) && (S.rec.who === "all" || e.person === S.rec.who)
    && (!q || [e.place, e.purpose, e.desc, e.cat, e.notes, e.car, e.basis, pName(e.person)].join(" ").toLowerCase().includes(q))).sort(byNewest);
}
function recListHTML() {
  const list = recFiltered(); if (!list.length) return `<div class="empty">No records match.</div>`;
  const groups = []; for (const e of list) { const k = e.date.slice(0, 7); let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, items: [] }); g.items.push(e); }
  return groups.map(g => { const [y, m] = g.k.split("-"); const tot = g.items.filter(live).reduce((a, e) => a + (e.type === "trip" ? tripClaim(e) : expClaim(e)), 0);
    return `<div class="month"><span>${MONTHS[+m - 1]} ${y}</span><span>${money(tot)}</span></div><div class="list">${g.items.map(liEntry).join("")}</div>`; }).join("");
}
function viewRecords() {
  return `<section class="view"><h1 style="font-size:24px">Records</h1>
    ${fySelect("fyRec")}
    <div class="field"><label for="recQ" style="position:absolute;left:-9999px">Search records</label><input id="recQ" type="search" placeholder="Search place, item or purpose" value="${esc(S.rec.q)}"></div>
    ${seg([{ v: "all", l: "All" }, { v: "trip", l: "Trips" }, { v: "expense", l: "Expenses" }], S.rec.type, "recType")}
    ${seg(peopleOpts(true, "Both of us"), S.rec.who, "recWho")}
    <label class="check small"><input type="checkbox" id="recRemoved" ${S.rec.removed ? "checked" : ""}> Show removed records</label>
    <div class="note" style="display:flex;gap:8px;align-items:center"><span style="width:16px;height:16px;flex:none;display:flex">${IC.lock}</span>${S.fy} records are kept until ${fmtDate(keepUntil(S.fy))}. Every change is logged.</div>
    <div id="recList" style="display:flex;flex-direction:column;gap:8px">${recListHTML()}</div></section>`;
}
function viewSummary() {
  const who = S.sumWho || S.meta.me, pid = who === "all" ? null : who, c = calc(S.fy, pid), R = c.R;
  const rows = [
    ...(R.cpk || c.cars.length ? (c.cars.length ? c.cars : [{ car: "Car", km: 0, count: 0, claim: 0 }]).map(g => ({ name: "Car · cents per km", sub: `${g.car}${!pid && g.person ? " · " + pName(g.person) : ""} · ${kmf(g.over ? g.claimKm : g.km)} × ${cents(R.rate)} · ${g.count} trip${g.count === 1 ? "" : "s"}${g.over ? ` (capped from ${kmf(g.km)})` : ""}`, amt: g.claim })) : []),
    ...c.cats.map(x => ({ name: x.name, sub: x.count ? `${x.count} item${x.count === 1 ? "" : "s"}` : "None", amt: x.claim }))
  ];
  const maxKm = Math.max(1, ...c.places.map(p => p.km));
  return `<section class="view"><h1 style="font-size:24px">Tax year summary</h1>
    ${fySelect("fySum")}
    ${seg(peopleOpts(true, "Household"), who, "sumWho")}
    <div class="card"><div class="small" style="color:var(--ink-2)">Total deductions · ${fyRange(S.fy)}</div><div class="kpi" style="font-size:34px">${money(c.total)}</div>
      <div class="small" style="color:var(--ink-2)">${c.trips.length} trip${c.trips.length === 1 ? "" : "s"} · ${c.exps.length} expense${c.exps.length === 1 ? "" : "s"}${c.sample ? ' · <span class="tag warn">includes sample data</span>' : ""}</div></div>
    ${c.std ? `<div class="card"><h3>Itemised vs standard deduction</h3>
      <div class="line"><span>Work-related items counted toward it</span><b>${money(c.std.work)}</b></div>
      <div class="line"><span>Standard deduction ${S.fy}</span><b>${money(c.std.amt)}</b></div>
      <div class="line"><span>Claimed on top either way</span><b>${money(c.std.onTop)}</b></div>
      <div class="small" style="color:var(--ink-2)">${c.std.itemise ? `Itemising gives ${money(c.std.diff)} more.` : `The standard deduction gives ${money(c.std.diff)} more.`} If you itemise you must keep all the records, not just those above ${money(c.std.amt)}.</div></div>` : ""}
    <div class="list">${rows.map(r => `<div class="li" style="cursor:default"><span class="t"><b>${esc(r.name)}</b><span>${esc(r.sub)}</span></span><span class="amt">${money(r.amt)}</span></div>`).join("")}</div>
    ${c.places.length ? `<div class="card"><h3>Trips by place</h3>${c.places.map(p => `<div><div class="line"><span>${esc(p.name)}</span><span>${p.count} trip${p.count === 1 ? "" : "s"} · ${kmf(p.km)}</span></div><div class="bar" style="height:6px;margin-top:4px"><i style="width:${(p.km / maxKm * 100).toFixed(1)}%"></i></div></div>`).join("")}</div>` : ""}
    <div class="note">Rules for ${S.fy}: ${R.cpk ? `${cents(R.rate)}/km, ${R.cap.toLocaleString("en-AU")} km cap per car` : "cents per km off"}${R.std ? `, ${money(R.stdAmt)} standard deduction` : ", no standard deduction"}${R.inherited ? ` (borrowed from ${R.from || "defaults"} — set them in Settings)` : ""}. Records kept until ${fmtDate(keepUntil(S.fy))}.</div>
    ${!pid ? `<div class="line small" style="color:var(--ink-2);padding:0 2px"><span>By person</span><span>${people().map(p => `${esc(p.name)} ${money(calc(S.fy, p.id).total)}`).join(" · ")}</span></div>` : ""}
    <button type="button" class="btn primary big" data-act="report">${IC.doc}Run end-of-year PDF</button>
  </section>`;
}
function viewSettings() {
  const st = SET(), sec = (t, hint, rows) => `<div class="field"><div class="sec"><h3>${t}</h3><span class="xs muted">${hint || ""}</span></div><div class="list">${rows.join("")}</div></div>`;
  const li = (act, id, label, sub, val) => `<button type="button" class="li" data-act="${act}" data-id="${esc(id)}"><span class="t"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span><span class="amt" style="color:var(--accent);font-weight:500">${esc(val || "Edit")}</span></button>`;
  const add = (act, label) => `<button type="button" class="li" data-act="${act}" data-id=""><span class="t"><b style="color:var(--accent)">${esc(label)}</b></span><span class="amt" style="color:var(--accent)">+</span></button>`;
  const fys = Object.keys(st.rules || {}).sort().reverse(), nfy = fys.length ? nextFy(fys[0]) : fyOf(todayISO());
  const ruleSub = r => `${r.cpk ? `${cents(r.rate)}/km · ${(+r.cap).toLocaleString("en-AU")} km cap` : "cents per km off"} · ${r.std ? money(r.stdAmt) + " standard" : "no standard"}`;
  const samples = S.entries.filter(e => e.sample).length;
  return `<section class="view"><h1 style="font-size:24px">Settings</h1>
    <div class="field"><h3>This phone belongs to</h3>${seg(people().map(p => ({ v: p.id, l: p.name })), S.meta.me, "setMe")}</div>
    ${sec("Saved places", "Return trip from usual workplace", [...(st.places || []).map(p => li("editItem", "place:" + p.id, p.name, p.hidden ? "Hidden" : "", kmf(p.km))), add("editItem", "Add place").replace('data-id=""', 'data-id="place:"')])}
    ${sec("Cars", `${(rulesFor(fyOf(todayISO())).cap || 0).toLocaleString("en-AU")} km cap per car`, [...(st.cars || []).map(c => li("editItem", "car:" + c.id, c.name, [c.isDefault && "Default", c.hidden && "Hidden"].filter(Boolean).join(" · "))), add("editItem", "Add car").replace('data-id=""', 'data-id="car:"')])}
    ${sec("Tax year rules", "Set once each July", [...fys.map(f => li("rulesEdit", f, f, ruleSub({ ...DEFAULT_RULE, ...st.rules[f] }))), add("rulesNew", `Start ${nfy} (copies ${fys[0] || "defaults"})`).replace('data-id=""', `data-v="${nfy}"`)])}
    ${sec("Categories", "Rename, add or hide", [...(st.categories || []).map(c => li("editItem", "category:" + c.id, c.name, c.hidden ? "Hidden" : "")), add("editItem", "Add category").replace('data-id=""', 'data-id="category:"')])}
    ${sec("Purposes", "", [...(st.purposes || []).map((p, i) => li("editItem", "purpose:" + i, p, "")), add("editItem", "Add purpose").replace('data-id=""', 'data-id="purpose:"')])}
    ${sec("People", "Each has their own totals", [...people().map(p => li("editItem", "person:" + p.id, p.name, "")), add("editItem", "Add person").replace('data-id=""', 'data-id="person:"')])}
    ${sec("Reports & records", "", [li("editItem", "accountant:", "Accountant on the PDF", st.accountant || "—"), li("editItem", "retain:", "Keep records for", "Removed records stay recoverable for this long", `${st.retainYears} years`)])}
    ${sec("Backup & sync", "", [`<button type="button" class="li" data-act="goBackup"><span class="t"><b>Dropbox & backup file</b><span>${esc(dbxOn() ? "Connected · " + syncText().t : "Not connected")}${S.meta.wifiOnly !== false ? " · Wi‑Fi only" : ""}</span></span><span class="amt" style="color:var(--accent);font-weight:500">Open</span></button>`])}
    ${sec("Sample data", "", [samples ? `<button type="button" class="li" data-act="sampleRemove"><span class="t"><b>Remove 2025-26 sample</b><span>${samples} sample records loaded</span></span><span class="amt" style="color:var(--bad)">Remove</span></button>`
      : `<button type="button" class="li" data-act="sampleLoad"><span class="t"><b>Load 2025-26 sample</b><span>From your notes and expense log, to see how the reports work</span></span><span class="amt" style="color:var(--accent)">Load</span></button>`])}
    <div class="row small muted"><span>Our Tax version <b>${APP_VERSION}</b></span><span class="sp"></span><button type="button" class="btn sm ghost" data-act="checkUpdate">Check for update</button></div>
  </section>`;
}

/* ================= sheets (full-screen forms) ================= */
function openSheet(sh) { S.sheet = sh; renderSheet(); }
function closeSheet() { S.sheet = null; const el = $("#sheet"); el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; render(); }
function sheetFrame(title, body, foot) {
  return `<div class="sh-head"><button type="button" class="iconbtn" data-act="closeSheet" aria-label="Back">${IC.back}</button><h2>${esc(title)}</h2><span style="width:44px"></span></div>
    <div class="sh-body"><div class="wrap view">${body}</div></div>${foot ? `<div class="sh-foot"><div class="wrap">${foot}</div></div>` : ""}`;
}
function renderSheet() {
  const el = $("#sheet"), body = $(".sh-body", el), sc = body ? body.scrollTop : 0, sh = S.sheet; if (!sh) return;
  const html = sh.kind === "trip" ? sheetTrip() : sh.kind === "expense" ? sheetExpense() : sh.kind === "rules" ? sheetRules() : sh.kind === "item" ? sheetItem() : sh.kind === "report" ? sheetReport() : sh.kind === "backup" ? sheetBackup() : "";
  el.innerHTML = html; el.hidden = false; document.body.style.overflow = "hidden";
  const nb = $(".sh-body", el); if (nb && sh.keepScroll !== false) nb.scrollTop = sc;
  if (sh.kind === "expense") paintThumbs();
}
const placeById = id => (SET().places || []).find(p => p.id === id);
const carById = id => (SET().cars || []).find(c => c.id === id);
function historyHTML(e) { const log = e && e.log || []; return log.length ? `<div class="field"><h3>Change history</h3><div class="log">${log.map(l => `<span>${esc(fmtDate(String(l.at).slice(0, 10)))} · ${esc(l.by || "")} · ${esc(l.act)}</span>`).join("")}</div></div>` : ""; }
function removeButtons(e) {
  if (!e) return "";
  if (e.removed) return `<div class="row"><button type="button" class="btn" data-act="restoreEntry">Restore this record</button>${!inRetention(e) || e.sample ? `<button type="button" class="btn danger" data-act="purgeEntry">Delete permanently</button>` : ""}</div>`;
  return `<div class="row"><button type="button" class="btn danger" data-act="removeEntry">Remove this record</button></div>`;
}

/* --- trip --- */
function newTrip() {
  const pl = placeById(S.meta.lastPlace) && !placeById(S.meta.lastPlace).hidden ? placeById(S.meta.lastPlace) : visPlaces()[0];
  return { person: (S.who && S.who !== "all") ? S.who : S.meta.me, placeId: pl ? pl.id : "other", km: pl ? pl.km : null, otherName: "", saveOther: true,
    mode: "day", date: todayISO(), from: todayISO(), to: todayISO(), weekdays: true, purpose: S.meta.lastPurpose || (SET().purposes || [])[0] || "", carId: (defCar() || {}).id || "", notes: "" };
}
function tripDates(f) {
  if (f.mode !== "range") return f.date ? [f.date] : [];
  if (!f.from || !f.to || f.to < f.from) return [];
  const out = []; for (let d = f.from; d <= f.to && out.length < 92; d = addDays(d, 1)) { const w = parseISO(d).getDay(); if (!f.weekdays || (w > 0 && w < 6)) out.push(d); } return out;
}
function tripFoot() {
  const f = S.sheet.f, ds = tripDates(f), km = num(f.km) || 0, R = rulesFor(fyOf(ds[0] || todayISO()));
  const claim = R.cpk ? r2(km * ds.length * R.rate) : 0, edit = !!S.sheet.id;
  const txt = ds.length > 1 ? `${ds.length} trips × ${kmf(km)} = ${kmf(km * ds.length)}` : `${kmf(km)} at ${cents(R.rate)}/km`;
  return `<div class="sum"><span>${esc(txt)}</span><b>${money(claim)}</b></div><button type="button" class="btn primary big" data-act="saveTrip">${edit ? "Save changes" : ds.length > 1 ? `Save ${ds.length} trips` : "Save trip"}</button>`;
}
function sheetTrip() {
  const f = S.sheet.f, edit = !!S.sheet.id, e = edit ? S.entries.find(x => x.id === S.sheet.id) : null;
  const pls = visPlaces(); if (edit && f.placeId !== "other" && !pls.find(p => p.id === f.placeId) && placeById(f.placeId)) pls.push(placeById(f.placeId));
  const cars = visCars(); if (f.carId && !cars.find(c => c.id === f.carId) && carById(f.carId)) cars.push(carById(f.carId));
  const today = todayISO(), yest = addDays(today, -1);
  const body = `${seg(people().map(p => ({ v: p.id, l: p.name })), f.person, "fPerson")}
    <div class="field"><span class="flabel">Where</span><div class="places">
      ${pls.map(p => `<button type="button" class="place ${f.placeId === p.id ? "on" : ""}" data-act="fPlace" data-v="${p.id}"><b>${esc(p.name)}</b><span>${kmf(p.km)} return</span></button>`).join("")}
      <button type="button" class="place ${f.placeId === "other" ? "on" : "add"}" data-act="fPlace" data-v="other">${f.placeId === "other" ? "<b>Other place</b><span>type it below</span>" : "+ Other place"}</button></div></div>
    ${f.placeId === "other" ? `<div class="grid2"><div class="field"><label for="fOther">Place</label><input id="fOther" data-f="otherName" value="${esc(f.otherName)}" placeholder="e.g. Penrith Court"></div>
      <div class="field"><label for="fKm">Km (return)</label><input id="fKm" data-f="km" inputmode="decimal" value="${esc(f.km ?? "")}"></div></div>
      ${edit ? "" : `<label class="check"><input type="checkbox" data-f="saveOther" ${f.saveOther ? "checked" : ""}> Save it as a place for next time</label>`}`
    : `<div class="field"><label for="fKm">Distance (km, return trip from usual workplace)</label><input id="fKm" data-f="km" inputmode="decimal" value="${esc(f.km ?? "")}"><span class="hint">Change it here if this trip was different — the saved place stays as it is.</span></div>`}
    <div class="field"><span class="flabel">When</span>
      ${edit ? "" : seg([{ v: "day", l: "One day" }, { v: "range", l: "Date range" }], f.mode, "fMode")}
      ${f.mode === "day" || edit ? `<div class="row">${edit ? "" : `<button type="button" class="chip ${f.date === today ? "on" : ""}" data-act="fDay" data-v="${today}">Today</button><button type="button" class="chip ${f.date === yest ? "on" : ""}" data-act="fDay" data-v="${yest}">Yesterday</button>`}
        <div class="field" style="flex:1;min-width:150px"><label for="fDate" style="position:absolute;left:-9999px">Date</label><input id="fDate" type="date" data-f="date" value="${esc(f.date)}" max="${addDays(today, 60)}"></div></div><div class="small muted">${esc(fmtDay(f.date))}</div>`
      : `<div class="grid2"><div class="field"><label for="fFrom">From</label><input id="fFrom" type="date" data-f="from" value="${esc(f.from)}"></div><div class="field"><label for="fTo">To</label><input id="fTo" type="date" data-f="to" value="${esc(f.to)}"></div></div>
        <label class="check"><input type="checkbox" data-f="weekdays" ${f.weekdays ? "checked" : ""}> Weekdays only</label><div class="small muted" id="rangeInfo">${rangeInfo(f)}</div>`}
    </div>
    <div class="field"><span class="flabel">Purpose</span><div class="chips">${[...new Set([...(SET().purposes || []), ...(f.purpose ? [f.purpose] : [])])].map(p => `<button type="button" class="chip ${f.purpose === p ? "on" : ""}" data-act="fPurpose" data-v="${esc(p)}">${esc(p)}</button>`).join("")}<button type="button" class="chip add" data-act="newPurpose">+ New</button></div></div>
    <div class="field"><label for="fCar">Car</label><select id="fCar" data-f="carId">${cars.map(c => `<option value="${c.id}" ${f.carId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="fNotes">Notes (optional)</label><input id="fNotes" data-f="notes" value="${esc(f.notes)}" placeholder="e.g. matter, officer in charge"></div>
    ${edit ? removeButtons(e) + historyHTML(e) : ""}`;
  return sheetFrame(edit ? "Edit trip" : "Add trip", body, `<div id="foot">${tripFoot()}</div>`);
}
function rangeInfo(f) { const ds = tripDates(f); return ds.length ? `Creates ${ds.length} separate trip${ds.length === 1 ? "" : "s"}: ${fmtDay(ds[0])}${ds.length > 1 ? " to " + fmtDay(ds[ds.length - 1]) : ""}` : "Pick a From and To date"; }
async function saveTrip() {
  const f = S.sheet.f, edit = S.sheet.id, ds = edit ? [f.date] : tripDates(f), km = num(f.km);
  if (!ds.length || !ds[0]) { toast("Pick a date"); return; }
  if (!(km > 0)) { toast("Enter the km for the trip"); return; }
  if (f.placeId === "other" && !f.otherName.trim()) { toast("Type the place"); return; }
  if (!f.purpose) { toast("Pick a purpose"); return; }
  let st = SET(), place = placeById(f.placeId), placeId = f.placeId, placeNm = place ? place.name : f.otherName.trim();
  if (f.placeId === "other" && f.saveOther && !edit) { st = clone(st); const p = { id: uid("pl"), name: placeNm, km }; st.places = [...(st.places || []), p]; placeId = p.id; await saveSettings(st); }
  if (f.placeId === "other" && !(f.saveOther && !edit)) placeId = null;
  const car = carById(f.carId) || defCar();
  const dup = ds.filter(d => S.entries.some(x => live(x) && x.type === "trip" && x.id !== edit && x.person === f.person && x.date === d && x.place === placeNm));
  if (dup.length && !confirm(`There's already a trip to ${placeNm} on ${dup.map(fmtDay).join(", ")}. Save anyway?`)) return;
  const by = pName(S.meta.me), at = new Date().toISOString();
  if (edit) {
    const o = S.entries.find(x => x.id === edit), n = { ...clone(o), person: f.person, date: f.date, placeId, place: placeNm, km, purpose: f.purpose, carId: car ? car.id : null, car: car ? car.name : "", notes: f.notes.trim() };
    const ch = diffText(o, n, { date: ["date", fmtDate], place: ["place"], km: ["km"], purpose: ["purpose"], car: ["car"], person: ["person", pName], notes: ["notes"] });
    if (!ch) { closeSheet(); return; }
    n.log = [...(o.log || []), { at, by, act: "Changed " + ch }]; await dbPut("entries", n);
  } else {
    let i = 0; for (const d of ds) await dbPut("entries", { id: uid("t") + (i++), type: "trip", person: f.person, date: d, placeId, place: placeNm, km, purpose: f.purpose, carId: car ? car.id : null, car: car ? car.name : "", notes: f.notes.trim(), created: Date.now(), log: [{ at, by, act: "Added" }] });
    S.meta.lastPlace = placeId; S.meta.lastPurpose = f.purpose; await saveMeta();
  }
  await reload(); const R = rulesFor(fyOf(ds[0])); closeSheet();
  toast(edit ? "Trip updated" : ds.length > 1 ? `${ds.length} trips saved · ${kmf(km * ds.length)}` : `Trip saved · ${kmf(km)} · ${money(R.cpk ? km * R.rate : 0)}`);
}
function diffText(o, n, fields) { const out = []; for (const [k, [lab, fmt]] of Object.entries(fields)) { const a = o[k] ?? "", b = n[k] ?? ""; if (String(a) !== String(b)) { const f = fmt || (x => x); out.push(`${lab} ${a === "" ? "(blank)" : f(a)} → ${b === "" ? "(blank)" : f(b)}`); } } return out.join(", "); }

/* --- expense --- */
function newExpense() {
  const cats = visCats(), c = cats.find(x => x.id === S.meta.lastCat) || cats[0];
  return { person: (S.who && S.who !== "all") ? S.who : S.meta.me, date: todayISO(), catId: c ? c.id : "", desc: "", amount: "", pct: 100, basis: "", notes: "", files: [], added: [] };
}
function expFoot() {
  const f = S.sheet.f, amt = num(f.amount) || 0, pct = num(f.pct) ?? 100, claim = r2(amt * pct / 100);
  return `<div class="sum"><span>${pct < 100 ? `Claim: ${money(amt)} × ${pct}%` : "Claim"}</span><b>${money(claim)}</b></div><button type="button" class="btn primary big" data-act="saveExpense">${S.sheet.id ? "Save changes" : "Save expense"}</button>`;
}
function catHint(f) {
  const R = rulesFor(fyOf(f.date || todayISO())); if (!R.std) return "";
  return R.stdCats.includes(f.catId) ? `Counts toward the ${money(R.stdAmt)} standard deduction comparison for ${R.fy}.` : `Claimed on top of the ${money(R.stdAmt)} standard deduction for ${R.fy}.`;
}
function instantHint(f) { const R = rulesFor(fyOf(f.date || todayISO())), amt = num(f.amount) || 0; return amt > R.instant && ["cat-work", "cat-uniform"].includes(f.catId) ? `Over ${money(R.instant)}: equipment like this is usually claimed over its life (depreciation) rather than all at once. Check with ${SET().accountant || "your accountant"}.` : ""; }
function sheetExpense() {
  const f = S.sheet.f, edit = !!S.sheet.id, e = edit ? S.entries.find(x => x.id === S.sheet.id) : null;
  const cats = visCats(); if (f.catId && !cats.find(c => c.id === f.catId)) cats.push({ id: f.catId, name: catName(f.catId) || (e && e.cat) || "Other" });
  const body = `<div class="grid2">${seg(people().map(p => ({ v: p.id, l: p.name })), f.person, "fPerson")}<div class="field"><label for="eDate" style="position:absolute;left:-9999px">Date</label><input id="eDate" type="date" data-f="date" value="${esc(f.date)}"></div></div>
    <div class="field"><span class="flabel">Category</span><div class="chips">${cats.map(c => `<button type="button" class="chip ${f.catId === c.id ? "on" : ""}" data-act="fCat" data-v="${c.id}">${esc(c.name)}</button>`).join("")}</div><span class="hint" id="catHint">${esc(catHint(f))}</span></div>
    <div class="field"><label for="eDesc">What was it</label><input id="eDesc" data-f="desc" value="${esc(f.desc)}" placeholder="e.g. Drycleaning, keyboard, union fees"></div>
    <div class="grid2"><div class="field"><label for="eAmt">Full cost</label><input id="eAmt" data-f="amount" inputmode="decimal" value="${esc(f.amount)}" placeholder="$0.00"></div>
      <div class="field"><label for="ePct">Work use %</label><input id="ePct" data-f="pct" inputmode="numeric" value="${esc(f.pct)}"></div></div>
    <span class="hint" id="instHint" style="font-size:12.5px;color:var(--warn)">${esc(instantHint(f))}</span>
    <div class="field"><label for="eBasis">How the work % is worked out${num(f.pct) != null && num(f.pct) < 100 ? "" : " (if under 100%)"}</label><input id="eBasis" data-f="basis" value="${esc(f.basis)}" placeholder="e.g. 1,976 work hrs of 8,736 per year"></div>
    <div class="field"><span class="flabel">Receipts</span><div class="thumbs" id="thumbs"></div>
      <label class="btn" style="border-style:dashed;color:var(--accent)">${IC.camera}Add receipt photo<input type="file" id="eFile" accept="image/*,application/pdf" multiple hidden></label></div>
    <div class="field"><label for="eNotes">Notes (optional)</label><input id="eNotes" data-f="notes" value="${esc(f.notes)}"></div>
    ${edit ? removeButtons(e) + historyHTML(e) : ""}`;
  return sheetFrame(edit ? "Edit expense" : "Add expense", body, `<div id="foot">${expFoot()}</div>`);
}
async function fileURL(id) { if (S.urls[id]) return S.urls[id]; const f = await dbGet("files", id); if (!f) return null; S.urls[id] = URL.createObjectURL(f.blob); return S.urls[id]; }
async function paintThumbs() {
  const el = $("#thumbs"); if (!el || !S.sheet) return; const ids = S.sheet.f.files || [];
  const items = await Promise.all(ids.map(async id => { const f = await dbGet("files", id); if (!f) return ""; const u = await fileURL(id);
    return `<div class="thumb">${/pdf/.test(f.type) ? `<a href="${u}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;height:100%;font-weight:600;color:var(--ink-2);text-decoration:none">PDF</a>` : `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Receipt photo"></a>`}<button type="button" data-act="dropFile" data-id="${id}" aria-label="Remove photo">×</button></div>`; }));
  el.innerHTML = items.join("") || `<span class="small muted">No receipt yet.</span>`;
}
async function resizeImage(file, max = 1600) {
  try { const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return await new Promise(r => c.toBlob(r, "image/jpeg", 0.8)); }
  catch { return file; }
}
async function addFiles(list) {
  for (const file of list) { const isImg = /^image\//.test(file.type), blob = isImg ? await resizeImage(file) : file; const id = uid("f"); await dbPut("files", { id, type: isImg ? "image/jpeg" : file.type || "application/octet-stream", name: file.name || id, blob }); S.sheet.f.files.push(id); S.sheet.f.added.push(id); }
  paintThumbs();
}
async function saveExpense() {
  const f = S.sheet.f, edit = S.sheet.id, amt = num(f.amount), pct = num(f.pct);
  if (!f.date) { toast("Pick a date"); return; }
  if (!f.catId) { toast("Pick a category"); return; }
  if (!f.desc.trim()) { toast("Say what it was"); return; }
  if (!(amt > 0)) { toast("Enter the cost"); return; }
  if (pct == null || pct < 0 || pct > 100) { toast("Work use must be 0 to 100%"); return; }
  const by = pName(S.meta.me), at = new Date().toISOString(), cat = catName(f.catId) || "Other";
  const base = { person: f.person, date: f.date, catId: f.catId, cat, desc: f.desc.trim(), amount: r2(amt), pct, basis: f.basis.trim(), notes: f.notes.trim(), files: [...f.files] };
  if (edit) {
    const o = S.entries.find(x => x.id === edit), n = { ...clone(o), ...base };
    let ch = diffText(o, n, { date: ["date", fmtDate], cat: ["category"], desc: ["item"], amount: ["cost", money], pct: ["work %"], person: ["person", pName], basis: ["basis"], notes: ["notes"] });
    const fa = (n.files || []).filter(x => !(o.files || []).includes(x)).length, fr = (o.files || []).filter(x => !(n.files || []).includes(x)).length;
    if (fa) ch = [ch, `${fa} receipt${fa > 1 ? "s" : ""} added`].filter(Boolean).join(", "); if (fr) ch = [ch, `${fr} receipt${fr > 1 ? "s" : ""} removed`].filter(Boolean).join(", ");
    if (!ch) { closeSheet(); return; }
    n.log = [...(o.log || []), { at, by, act: "Changed " + ch }]; await dbPut("entries", n);
    for (const id of fr ? (o.files || []).filter(x => !(n.files || []).includes(x)) : []) await dbDel("files", id);
  } else {
    await dbPut("entries", { id: uid("e"), type: "expense", ...base, created: Date.now(), log: [{ at, by, act: "Added" }] });
    S.meta.lastCat = f.catId; await saveMeta();
  }
  for (const id of f.added.filter(x => !f.files.includes(x))) await dbDel("files", id);
  f.added = []; await reload(); closeSheet(); toast(edit ? "Expense updated" : `Expense saved · ${money(r2(amt * pct / 100))}`);
}
async function cancelSheet() {
  if (S.sheet && S.sheet.kind === "expense") for (const id of S.sheet.f.added || []) await dbDel("files", id);
  closeSheet();
}
function openEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  if (e.type === "trip") openSheet({ kind: "trip", id, f: { person: e.person, placeId: e.placeId && placeById(e.placeId) ? e.placeId : "other", km: e.km, otherName: e.placeId && placeById(e.placeId) ? "" : e.place, saveOther: false, mode: "day", date: e.date, purpose: e.purpose || "", carId: e.carId || "", notes: e.notes || "" } });
  else openSheet({ kind: "expense", id, f: { person: e.person, date: e.date, catId: e.catId, desc: e.desc || "", amount: e.amount ?? "", pct: e.pct ?? 100, basis: e.basis || "", notes: e.notes || "", files: [...(e.files || [])], added: [] } });
}
async function setRemoved(flag) {
  const o = S.entries.find(x => x.id === S.sheet.id); if (!o) return;
  if (flag && !confirm(`Remove this record? It stops counting in totals but is kept, and can be restored, until ${fmtDate(keepUntil(fyOf(o.date)))}.`)) return;
  const n = { ...clone(o), removed: flag || undefined, log: [...(o.log || []), { at: new Date().toISOString(), by: pName(S.meta.me), act: flag ? "Removed" : "Restored" }] };
  if (!flag) delete n.removed;
  await dbPut("entries", n); await reload(); closeSheet(); toast(flag ? "Record removed (it can be restored from Records › Show removed)" : "Record restored");
}
async function purgeEntry() {
  const o = S.entries.find(x => x.id === S.sheet.id); if (!o) return;
  if (!confirm("Delete this record permanently? This can't be undone.")) return;
  for (const id of o.files || []) await dbDel("files", id);
  await dbDel("entries", o.id); await reload(); closeSheet(); toast("Record deleted");
}

/* --- tax year rules --- */
function sheetRules() {
  const f = S.sheet.f, st = SET(), used = S.entries.some(e => fyOf(e.date) === f.fy);
  const cats = [{ id: "car", name: "Car · cents per km" }, ...(st.categories || []).filter(c => !c.hidden || f.stdCats.includes(c.id))];
  const body = `<div class="note">Rules are saved per tax year. Changing ${f.fy} never changes another year, so past summaries and PDFs stay as they were lodged.</div>
    <div class="field"><h3>Car · cents per km</h3>
      <label class="check"><input type="checkbox" data-f="cpk" ${f.cpk ? "checked" : ""}> Cents per km method available</label>
      <div class="grid2"><div class="field"><label for="rRate">Rate (cents per km)</label><input id="rRate" data-f="rateC" inputmode="decimal" value="${esc(f.rateC)}"></div>
      <div class="field"><label for="rCap">Km cap per car</label><input id="rCap" data-f="cap" inputmode="numeric" value="${esc(f.cap)}"></div></div></div>
    <div class="field"><h3>Standard deduction</h3>
      <label class="check"><input type="checkbox" data-f="std" ${f.std ? "checked" : ""}> Applies this year</label>
      <div class="field"><label for="rStd">Amount</label><input id="rStd" data-f="stdAmt" inputmode="decimal" value="${esc(f.stdAmt)}"></div>
      <span class="hint">Off: the comparison disappears from Home, the summary and the PDF, and everything is simply itemised.</span></div>
    <div class="field"><h3>Counts toward the standard deduction</h3><div class="list" style="padding:0 14px">${cats.map(c => `<label class="check" style="border-bottom:1px solid var(--line);justify-content:space-between">${esc(c.name)}<input type="checkbox" data-cat="${c.id}" ${f.stdCats.includes(c.id) ? "checked" : ""}></label>`).join("")}</div>
      <span class="hint">Unticked categories are claimed on top.</span></div>
    <div class="field"><label for="rInst">Immediate deduction limit for equipment</label><input id="rInst" data-f="instant" inputmode="decimal" value="${esc(f.instant)}"><span class="hint">Expenses above this show a reminder that they may need depreciating.</span></div>
    ${!used && st.rules && st.rules[f.fy] ? `<div class="row"><button type="button" class="btn danger" data-act="rulesDelete">Delete ${f.fy} rules</button></div>` : ""}`;
  return sheetFrame(`${f.fy} rules`, body, `<button type="button" class="btn primary big" data-act="rulesSave">Save ${f.fy} rules</button>`);
}
function openRules(fy, copy) { const r = rulesFor(fy); openSheet({ kind: "rules", f: { fy, cpk: r.cpk, rateC: r2(r.rate * 100), cap: r.cap, std: r.std, stdAmt: r.stdAmt, stdCats: [...r.stdCats], instant: r.instant, isNew: !!copy } }); }
async function rulesSave() {
  const f = S.sheet.f, rate = num(f.rateC), cap = num(f.cap), stdAmt = num(f.stdAmt), instant = num(f.instant);
  if (f.cpk && !(rate > 0 && rate < 1000)) { toast("Enter the rate in cents, e.g. 91"); return; }
  if (f.cpk && !(cap > 0)) { toast("Enter the km cap"); return; }
  if (f.std && !(stdAmt > 0)) { toast("Enter the standard deduction amount"); return; }
  const st = clone(SET()); st.rules = st.rules || {};
  st.rules[f.fy] = { cpk: !!f.cpk, rate: r2((rate || 0) / 100 * 10000) / 10000, cap: cap || 0, std: !!f.std, stdAmt: stdAmt || 0, stdCats: f.stdCats, instant: instant ?? 300 };
  await saveSettings(st); closeSheet(); toast(`${f.fy} rules saved`);
}

/* --- settings items --- */
function openItem(key) {
  const [kind, id] = key.split(":"), st = SET(); let f = { kind, id, isNew: id === "" };
  if (kind === "place") { const p = (st.places || []).find(x => x.id === id) || {}; Object.assign(f, { name: p.name || "", km: p.km ?? "", hidden: !!p.hidden }); }
  else if (kind === "car") { const c = (st.cars || []).find(x => x.id === id) || {}; Object.assign(f, { name: c.name || "", isDefault: !!c.isDefault, hidden: !!c.hidden }); }
  else if (kind === "category") { const c = (st.categories || []).find(x => x.id === id) || {}; Object.assign(f, { name: c.name || "", hidden: !!c.hidden }); }
  else if (kind === "purpose") Object.assign(f, { name: id === "" ? "" : (st.purposes || [])[+id] || "" });
  else if (kind === "person") { const p = people().find(x => x.id === id) || {}; Object.assign(f, { name: p.name || "" }); }
  else if (kind === "accountant") Object.assign(f, { name: st.accountant || "", isNew: false });
  else if (kind === "retain") Object.assign(f, { years: st.retainYears || 7, isNew: false });
  openSheet({ kind: "item", f });
}
function sheetItem() {
  const f = S.sheet.f, T = { place: "place", car: "car", category: "category", purpose: "purpose", person: "person", accountant: "Accountant", retain: "Keep records for" };
  const title = f.kind === "accountant" || f.kind === "retain" ? T[f.kind] : (f.isNew ? "Add " : "Edit ") + T[f.kind];
  let body = "";
  if (f.kind === "retain") body = `<div class="field"><label for="iYears">Years after the end of each tax year</label><input id="iYears" data-f="years" inputmode="numeric" value="${esc(f.years)}"><span class="hint">The ATO generally asks for 5 years from lodging. Records can't be permanently deleted before this.</span></div>`;
  else body = `<div class="field"><label for="iName">${f.kind === "accountant" ? "Name shown on the PDF" : "Name"}</label><input id="iName" data-f="name" value="${esc(f.name)}"></div>`;
  if (f.kind === "place") body += `<div class="field"><label for="iKm">Km — return trip from your usual workplace</label><input id="iKm" data-f="km" inputmode="decimal" value="${esc(f.km)}"></div>`;
  if (f.kind === "car") body += `<label class="check"><input type="checkbox" data-f="isDefault" ${f.isDefault ? "checked" : ""}> Default car for new trips</label>`;
  if (["place", "car", "category"].includes(f.kind) && !f.isNew) body += `<label class="check"><input type="checkbox" data-f="hidden" ${f.hidden ? "checked" : ""}> Hide it (past records keep it)</label>`;
  if (["place", "car", "category", "person"].includes(f.kind) && !f.isNew) body += `<div class="note">Past records keep the name they were saved with. Renaming only affects new records.</div>`;
  if (f.kind === "purpose" && !f.isNew) body += `<div class="row"><button type="button" class="btn danger" data-act="itemDelete">Remove from the list</button></div>`;
  return sheetFrame(title, body, `<button type="button" class="btn primary big" data-act="itemSave">Save</button>`);
}
async function itemSave() {
  const f = S.sheet.f, st = clone(SET()), name = (f.name || "").trim();
  if (f.kind !== "retain" && !name) { toast("Enter a name"); return; }
  if (f.kind === "place") { const km = num(f.km); if (!(km > 0)) { toast("Enter the km"); return; } st.places = st.places || []; if (f.isNew) st.places.push({ id: uid("pl"), name, km }); else { const p = st.places.find(x => x.id === f.id); Object.assign(p, { name, km, hidden: !!f.hidden || undefined }); } }
  else if (f.kind === "car") { st.cars = st.cars || []; let c; if (f.isNew) st.cars.push(c = { id: uid("car"), name }); else { c = st.cars.find(x => x.id === f.id); c.name = name; c.hidden = !!f.hidden || undefined; } if (f.isDefault) st.cars.forEach(x => x.isDefault = x === c); else c.isDefault = false; }
  else if (f.kind === "category") { st.categories = st.categories || []; if (f.isNew) st.categories.push({ id: uid("cat"), name }); else Object.assign(st.categories.find(x => x.id === f.id), { name, hidden: !!f.hidden || undefined }); }
  else if (f.kind === "purpose") { st.purposes = st.purposes || []; if (f.isNew) { if (!st.purposes.includes(name)) st.purposes.push(name); } else st.purposes[+f.id] = name; }
  else if (f.kind === "person") { st.people = st.people || []; if (f.isNew) st.people.push({ id: uid("p"), name }); else st.people.find(x => x.id === f.id).name = name; }
  else if (f.kind === "accountant") st.accountant = name;
  else if (f.kind === "retain") { const y = num(f.years); if (!(y >= 5 && y <= 30)) { toast("Choose 5 to 30 years"); return; } st.retainYears = Math.round(y); }
  await saveSettings(st); closeSheet(); toast("Saved");
}
async function itemDelete() { const f = S.sheet.f, st = clone(SET()); if (f.kind === "purpose") st.purposes.splice(+f.id, 1); await saveSettings(st); closeSheet(); toast("Removed"); }

/* ================= end-of-year PDF ================= */
function sheetReport() {
  const f = S.sheet.f;
  const body = `<div class="field"><label for="rpFy">Tax year</label><select id="rpFy" data-f="fy">${fyList().map(x => `<option ${x === f.fy ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="field"><span class="flabel">For</span>${seg(people().map(p => ({ v: p.id, l: p.name })), f.person, "rpPerson")}</div>
    <label class="check"><input type="checkbox" data-f="tripLog" ${f.tripLog ? "checked" : ""}> Full trip log</label>
    <label class="check"><input type="checkbox" data-f="photos" ${f.photos ? "checked" : ""}> Receipt photos at the end</label>
    <div class="note">Tap <b>Make PDF</b>, then in the print screen choose <b>Save as PDF</b> (top of the screen) and save it. Email the PDF to ${esc(SET().accountant || "your accountant")}.</div>`;
  return sheetFrame("End-of-year PDF", body, `<button type="button" class="btn primary big" data-act="makePdf">${IC.doc}Make PDF</button>`);
}
async function makePdf() {
  const f = S.sheet.f, c = calc(f.fy, f.person), R = c.R, st = SET(), name = pName(f.person);
  const T = (head, rows, foot) => `<table class="rt"><thead><tr>${head.map(h => `<th class="${h[1] || ""}">${h[0]}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table>`;
  const sumRows = [...c.cars.map(g => `<tr><td>Car expenses — cents per km (${esc(g.car)})</td><td class="n">${money(g.claim)}</td></tr>`), ...(!c.cars.length && R.cpk ? [`<tr><td>Car expenses — cents per km</td><td class="n">${money(0)}</td></tr>`] : []), ...c.cats.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${money(x.claim)}</td></tr>`)];
  const trips = [...c.trips].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0));
  const exps = [...c.exps].sort((a, b) => a.date < b.date ? -1 : 1);
  const files = []; for (const e of exps) for (const id of e.files || []) { const fl = await dbGet("files", id); if (fl) files.push({ e, fl, url: await fileURL(id) }); }
  let h = `<style>#report{font:10pt/1.4 "IBM Plex Sans",Arial,sans-serif;color:#111}#report h1{font-size:20pt;margin:2pt 0}#report h2{font-size:12pt;margin:16pt 0 6pt}#report .k{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#555;font-weight:600}
    #report .hd{display:flex;justify-content:space-between;border-bottom:1.5pt solid #111;padding-bottom:8pt}#report .meta{text-align:right;font-size:9pt;color:#444}
    #report .rt{width:100%;border-collapse:collapse;font-size:9pt}#report .rt th,#report .rt td{border-bottom:.5pt solid #bbb;padding:3pt 5pt;text-align:left;vertical-align:top}#report .rt thead th{border-bottom:1pt solid #333;font-size:8pt;color:#333}#report .rt tfoot td{font-weight:700;border-top:1pt solid #333;border-bottom:0}#report .n{text-align:right;white-space:nowrap}
    #report .facts{display:flex;gap:6pt;flex-wrap:wrap;margin-bottom:6pt}#report .facts div{border:.5pt solid #bbb;border-radius:4pt;padding:4pt 8pt;font-size:8pt;color:#444}#report .facts b{display:block;font-size:10.5pt;color:#111}
    #report p{margin:4pt 0}#report .sm{font-size:8.5pt;color:#444}#report .ph{display:grid;grid-template-columns:1fr 1fr;gap:10pt}#report .ph figure{margin:0;break-inside:avoid}#report .ph img{width:100%;max-height:115mm;object-fit:contain;border:.5pt solid #ccc}#report figcaption{font-size:8.5pt;color:#333;margin-top:2pt}
    #report .ft{margin-top:14pt;border-top:.5pt solid #bbb;padding-top:5pt;font-size:8pt;color:#555}#report tr,#report .facts{break-inside:avoid}</style>
  <div class="hd"><div><div class="k">Work-related deductions · ${f.fy}</div><h1>${esc(name)}</h1><div>Prepared for ${esc(st.accountant || "the tax agent")}</div></div>
    <div class="meta">Period ${fyRange(f.fy)}<br>Generated ${fmtDate(todayISO())}<br>Our Tax v${APP_VERSION}</div></div>
  <h2>1. Summary</h2>${T([["Category"], ["Amount", "n"]], sumRows, `<tr><td>Total deductions</td><td class="n">${money(c.total)}</td></tr>`)}`;
  if (c.std) h += `<p class="sm" style="margin-top:6pt">Standard deduction ${f.fy}: ${money(c.std.amt)}. Work-related items above that count toward it total ${money(c.std.work)}; ${money(c.std.onTop)} is claimed on top either way. ${c.std.itemise ? "Itemised work-related expenses exceed the standard deduction." : "The standard deduction is larger than the itemised work-related expenses."}</p>`;
  if (c.sample) h += `<p class="sm"><b>Note:</b> includes sample data loaded to test the app.</p>`;
  if (trips.length || R.cpk) {
    h += `<h2>2. Car expenses — cents per kilometre method</h2>`;
    for (const g of c.cars) h += `<div class="facts"><div>Vehicle<b>${esc(g.car)}</b></div><div>Rate<b>${cents(R.rate)} / km</b></div><div>Trips<b>${g.count}</b></div><div>Business km<b>${kmf(g.km)}</b></div>${g.over ? `<div>Km claimed (cap)<b>${kmf(g.claimKm)}</b></div>` : ""}<div>Claim<b>${money(g.claim)}</b></div></div>`;
    h += `<p class="sm">Distances are return trips from the usual place of work to the place attended, using a set distance for each location. Each trip was recorded in Our Tax as it occurred. The car is owned by the taxpayer.</p>`;
    if (f.tripLog && trips.length) h += T([["Date"], ["Destination"], ["Purpose"], ["Car"], ["Km", "n"], ["Amount", "n"]], trips.map(t => `<tr><td>${fmtAU(t.date)}</td><td>${esc(t.place)}</td><td>${esc(t.purpose || "")}${t.notes ? ` — ${esc(t.notes)}` : ""}</td><td>${esc(t.car || "")}</td><td class="n">${t.km}</td><td class="n">${money(tripClaim(t))}</td></tr>`), `<tr><td colspan="4">${trips.length} trips</td><td class="n">${c.km}</td><td class="n">${money(c.carClaim)}</td></tr>`);
  }
  h += `<h2>3. Other expenses</h2>` + (exps.length ? T([["Date"], ["Category"], ["Item"], ["Cost", "n"], ["Work %", "n"], ["Claim", "n"], ["Receipt"]], exps.map(e => `<tr><td>${fmtAU(e.date)}</td><td>${esc(e.cat)}</td><td>${esc(e.desc)}${e.basis ? `<br><span class="sm">${esc(e.basis)}</span>` : ""}${e.notes ? `<br><span class="sm">${esc(e.notes)}</span>` : ""}</td><td class="n">${money(e.amount)}</td><td class="n">${e.pct ?? 100}%</td><td class="n">${money(expClaim(e))}</td><td>${(e.files || []).length ? "Yes" : "—"}</td></tr>`), `<tr><td colspan="5">${exps.length} items</td><td class="n">${money(r2(exps.reduce((a, e) => a + expClaim(e), 0)))}</td><td></td></tr>`) : `<p class="sm">None recorded.</p>`);
  if (f.photos && files.length) h += `<h2 style="break-before:page">4. Receipts</h2><div class="ph">${files.map(x => /^image\//.test(x.fl.type) ? `<figure><img src="${x.url}" alt=""><figcaption>${fmtAU(x.e.date)} · ${esc(x.e.desc)} · ${money(x.e.amount)}</figcaption></figure>` : `<figure><figcaption>${fmtAU(x.e.date)} · ${esc(x.e.desc)} · PDF receipt kept in Our Tax</figcaption></figure>`).join("")}</div>`;
  h += `<div class="ft">Records for ${f.fy} are kept until ${fmtDate(keepUntil(f.fy))}. Rules applied: ${R.cpk ? `${cents(R.rate)}/km, ${R.cap.toLocaleString("en-AU")} km cap per car` : "cents per km not used"}${R.std ? `, ${money(R.stdAmt)} standard deduction` : ""}.</div>`;
  const rep = $("#report"); rep.innerHTML = h;
  await Promise.all($$("img", rep).map(i => i.decode ? i.decode().catch(() => {}) : null));
  const t = document.title; document.title = `${name} work deductions ${f.fy}`; window.print(); setTimeout(() => { document.title = t; }, 1500);
}

/* ================= backup file ================= */
const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
async function backupFile() {
  const files = await dbAll("files"), d = await localData(files);
  d.files = await Promise.all(files.map(async f => ({ id: f.id, type: f.type, name: f.name, data: await b64(f.blob) })));
  const blob = new Blob([JSON.stringify({ app: APP_ID, backup: BACKUP_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), data: d })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ourtax-backup-${todayISO()}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  S.meta.lastBackup = new Date().toISOString(); await saveMeta(); toast("Backup file saved to Downloads");
}
async function restoreFile(file) {
  try {
    const j = JSON.parse(await file.text()); const d = readPayload(j);
    if (!confirm(`Restore ${d.entries.length} records from this file? It replaces everything on this phone${dbxOn() ? " and in Dropbox (the current copy is saved as a snapshot first)" : ""}.`)) return;
    if (!(await snapshotBeforeReplace())) return;
    for (const f of d.files) if (f.data) { const r = await fetch(f.data); f._blob = new Blob([await r.blob()], { type: f.type }); }
    _quiet++;
    try { for (const e of await dbAll("entries")) await dbDel("entries", e.id); for (const f of await dbAll("files")) await dbDel("files", f.id);
      for (const e of d.entries) await dbPut("entries", e); for (const f of d.files) if (f._blob) await dbPut("files", { id: f.id, type: f.type, name: f.name, blob: f._blob }); } finally { _quiet--; }
    if (d.settings) S.meta.settings = d.settings; S.meta.tomb = {}; S.meta.conflict = null; S.meta.gen = uid("g"); S.meta.genPending = true; S.meta.sentFiles = []; await saveMeta(); markDirty();
    await reload(); closeSheet(); toast(`Restored ${S.entries.length} records`);
  } catch (e) { toast("That file couldn't be restored: " + (e.message || e)); }
}
function sheetBackup() {
  const body = `${dropboxPanel()}
    <div class="card"><h3>Backup file</h3><p style="margin:0" class="small">One file with every record, setting and receipt — an extra copy you can keep on the QNAP. Never upload it to GitHub.</p>
      <div class="row"><button type="button" class="btn" data-act="backupFile">Save backup file</button></div><span class="xs muted">Last backup file: ${S.meta.lastBackup ? fmtWhen(S.meta.lastBackup) : "never"}</span></div>
    <div class="card"><h3>Restore from a file</h3><p style="margin:0" class="small">Replaces everything in the app with the file's copy, on both phones.</p>
      <label class="btn">Choose backup file…<input type="file" id="restoreIn" accept="application/json,.json" hidden></label></div>`;
  return sheetFrame("Backup & sync", body, "");
}

/* ================= Dropbox: live copy + snapshots (same approach as MyGarage) =================
   Dropbox › Apps › <your Our Tax app>
     live/ourtax.json           records and settings — sent a few seconds after every change (Wi‑Fi only unless switched off)
     live/files/<id>.<ext>      receipt photos, each sent once
     snapshots/ourtax-*.json    one per day, plus one before every restore (kept 60 days)
     archive/ourtax-YYYY-MM.json   the last copy of each month (kept for the record-keeping period + 1 year)   */
const DBX_APP_KEY = ""; // public App key for the Our Tax Dropbox app — leave blank until created; it can be pasted in the app meanwhile
const DBX_TOKEN = "https://api.dropboxapi.com/oauth2/token";
const DBX_REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
const LIVE = "/live/ourtax.json";
let syncing = false, syncT = null, retryT = null, lastCheck = 0;
const appKey = () => DBX_APP_KEY || S.meta.dbxKey || "";
const dbxOn = () => !!(S.meta.dbx && S.meta.dbx.refresh);
const hasData = () => S.entries.length > 0;
const ownerName = () => pName(S.meta.me) + "'s phone, set up " + fmtDate(S.meta.created || todayISO());
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
class DbxErr extends Error { constructor(m, s, sum) { super(m); this.status = s; this.summary = sum || ""; } }
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtWhen = s => { if (!s) return "never"; const d = new Date(s); if (isNaN(d)) return "—"; const t = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); return (isoOf(d) === todayISO() ? "today" : fmtDate(isoOf(d))) + ", " + t; };
const fileExt = f => (f.type === "image/jpeg" ? "jpg" : f.type === "image/png" ? "png" : f.type === "application/pdf" ? "pdf" : (String(f.name || "").split(".").pop() || "bin")).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
const filePath = f => `/live/files/${f.id}.${fileExt(f)}`;
const notFound = e => e instanceof DbxErr && e.status === 409 && /not_found/.test(e.summary);
function snapName(kind) { const d = new Date(); return `/snapshots/ourtax-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}${kind ? "-" + p2(d.getHours()) + p2(d.getMinutes()) + "-" + kind : ""}.json`; }
const wifiOnly = () => S.meta.wifiOnly !== false; // on unless switched off
const mobileBlocked = () => !!(wifiOnly() && navigator.connection && navigator.connection.type === "cellular");

function markDirty() { if (_quiet) return; S.meta.dirty = true; S.meta.changes = (S.meta.changes || 0) + 1; S.meta.seq = (S.meta.seq || 0) + 1; saveMeta().catch(() => {}); scheduleSync(); paintStatus(); }
function syncText() {
  if (!dbxOn()) return hasData() ? { t: "not backed up", c: "warn" } : { t: "not connected", c: "" };
  if (S.meta.conflict) return { t: "Dropbox copy differs · tap", c: "warn" };
  if (syncing) return { t: "syncing…", c: "" };
  if (S.meta.syncError) return { t: "sync failed · tap", c: "warn" };
  if (S.meta.dirty) { const n = S.meta.changes || 1; return { t: `${n} change${n === 1 ? "" : "s"} waiting${mobileBlocked() ? " for Wi‑Fi" : ""}`, c: "" }; }
  return { t: "in Dropbox ✓", c: "ok" };
}
function paintStatus() {
  const el = $("#sync"); if (!el) return; const s = syncText();
  el.innerHTML = (s.c === "ok" ? IC.wifi : "") + esc((S.meta.me ? pName(S.meta.me) + " · " : "") + s.t); el.className = "sync " + s.c;
  const p = $("#dbxStatus"); if (p) p.textContent = cap1(s.t.replace(" · tap", ""));
}
async function dbxConnect() {
  if (!navigator.onLine) { toast("You're offline. Connect Dropbox when you have internet."); return; }
  const key = DBX_APP_KEY || (($("#dbxKey") || {}).value || S.meta.dbxKey || "").trim();
  if (!/^[a-z0-9]{8,}$/i.test(key)) { toast("Paste the App key from the Dropbox App Console first"); return; }
  const v = b64url(crypto.getRandomValues(new Uint8Array(48))), state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  S.meta.dbxKey = key; S.meta.pkce = { v, state }; S.meta.syncError = null; await saveMeta();
  location.href = "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({ client_id: key, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", redirect_uri: DBX_REDIRECT, token_access_type: "offline", state });
}
async function dbxReturn() {
  const p = new URLSearchParams(location.search);
  if (!p.has("code") && !p.has("error")) return false;
  history.replaceState(null, "", DBX_REDIRECT);
  if (p.has("error")) { toast("Dropbox not connected: " + (p.get("error_description") || p.get("error")).replace(/\+/g, " ")); return true; }
  if (!S.meta.pkce || p.get("state") !== S.meta.pkce.state) { toast("That Dropbox sign-in didn't match. Tap Connect Dropbox again."); return true; }
  try {
    const r = await fetch(DBX_TOKEN, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: p.get("code"), client_id: appKey(), code_verifier: S.meta.pkce.v, redirect_uri: DBX_REDIRECT }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "HTTP " + r.status);
    S.meta.dbx = { refresh: j.refresh_token, access: j.access_token, expires: Date.now() + (j.expires_in || 14400) * 1000 };
    S.meta.pkce = null; S.meta.dbxRev = null; S.meta.syncError = null; S.meta.conflict = null; S.meta.sentFiles = []; await saveMeta();
    toast(matchMedia("(display-mode: standalone)").matches ? "Dropbox connected" : "Dropbox connected. You can close this tab and open Our Tax from your home screen.");
  } catch (e) { S.meta.pkce = null; S.meta.syncError = "Dropbox sign-in failed: " + (e.message || e); await saveMeta(); toast(S.meta.syncError); }
  return true;
}
async function dbxToken() {
  const d = S.meta.dbx; if (!d || !d.refresh) throw new Error("Dropbox is not connected");
  if (d.access && d.expires > Date.now() + 60000) return d.access;
  const r = await fetch(DBX_TOKEN, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: d.refresh, client_id: appKey() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (j.error === "invalid_grant") { S.meta.dbx = null; S.meta.syncError = "Dropbox access was removed or has expired. Connect Dropbox again."; await saveMeta(); } throw new Error(j.error_description || j.error || "HTTP " + r.status); }
  d.access = j.access_token; d.expires = Date.now() + (j.expires_in || 14400) * 1000; await saveMeta(); return d.access;
}
async function dbxCall(url, opt = {}, retry = true) {
  const tok = await dbxToken();
  const r = await fetch(url, { method: "POST", ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + tok } });
  if (r.status === 401 && retry) { S.meta.dbx.access = null; return dbxCall(url, opt, false); }
  if (r.status === 429 && retry) { await sleep(3000); return dbxCall(url, opt, false); }
  if (!r.ok) { const t = await r.text().catch(() => ""); let s = t; try { s = JSON.parse(t).error_summary || t; } catch {} throw new DbxErr("Dropbox " + r.status + ": " + String(s).slice(0, 120), r.status, String(s)); }
  return r;
}
async function dbxApi(ep, arg) { const r = await dbxCall("https://api.dropboxapi.com/2/" + ep, arg === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(arg) }); const t = await r.text(); return t ? JSON.parse(t) : null; }
async function dbxMeta(path) { try { return await dbxApi("files/get_metadata", { path }); } catch (e) { if (notFound(e)) return null; throw e; } }
async function dbxUpload(path, body, mode) { const r = await dbxCall("https://content.dropboxapi.com/2/files/upload", { headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dbxArg({ path, mode: mode || "overwrite", autorename: false, mute: true }) }, body }); return r.json(); }
async function dbxDownload(path) { const r = await dbxCall("https://content.dropboxapi.com/2/files/download", { headers: { "Dropbox-API-Arg": dbxArg({ path }) } }); return r.blob(); }
async function dbxList(path) { try { let j = await dbxApi("files/list_folder", { path }), out = j.entries; while (j.has_more) { j = await dbxApi("files/list_folder/continue", { cursor: j.cursor }); out = out.concat(j.entries); } return out; } catch (e) { if (notFound(e)) return []; throw e; } }

/* Both phones can add and edit at the same time: each record carries the time it last changed (_t), permanent deletions are remembered
   (deleted: id → time), and every sync merges the two copies record by record — the most recent change wins, nothing new is dropped.
   A restore starts a new "generation" (gen) that replaces the copy everywhere instead of merging. */
async function localData(files) {
  files = files || await dbAll("files");
  const entries = await dbAll("entries");
  return { entries, settings: S.meta.settings || null, deleted: S.meta.tomb || {}, gen: S.meta.gen || null, files: files.map(f => ({ id: f.id, type: f.type, name: f.name, path: filePath(f) })) };
}
const wrap = d => JSON.stringify({ app: APP_ID, schema: 1, appVersion: APP_VERSION, updatedAt: new Date().toISOString(), owner: S.meta.deviceId, ownerName: ownerName(), data: d });
async function payloadJSON(files) { return wrap(await localData(files)); }
function readPayload(j) { const d = j && (j.data || j); if (!d || !Array.isArray(d.entries)) throw new Error("That isn't an Our Tax copy");
  return { entries: d.entries, settings: d.settings || null, files: Array.isArray(d.files) ? d.files : [], deleted: d.deleted || {}, gen: d.gen || null }; }
async function pushFiles(files) {
  const sent = new Set(S.meta.sentFiles || []); let n = 0;
  for (const f of files) { if (sent.has(f.id)) continue; await dbxUpload(filePath(f), f.blob, "overwrite"); sent.add(f.id); n++; if (n % 5 === 0) { S.meta.sentFiles = [...sent]; await saveMeta(); } }
  if (n) { S.meta.sentFiles = [...sent]; await saveMeta(); }
}
const tOf = r => (r && r._t) || 0;
function mergeData(L, R) {
  const deleted = { ...(R.deleted || {}) }; for (const [id, t] of Object.entries(L.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const pick = (a, b) => { const m = new Map(); for (const r of [...a, ...b]) { const c = m.get(r.id); if (!c || tOf(r) > tOf(c)) m.set(r.id, r); } return [...m.values()].filter(r => !(deleted[r.id] && deleted[r.id] >= tOf(r))); };
  const fm = new Map(); for (const f of [...R.files, ...L.files]) if (!deleted[f.id]) fm.set(f.id, f);
  const settings = tOf(L.settings) >= tOf(R.settings) ? L.settings || R.settings : R.settings;
  return { entries: pick(L.entries, R.entries), files: [...fm.values()], settings, deleted, gen: R.gen || L.gen };
}
const sig = d => JSON.stringify([d.entries.map(r => r.id + ":" + tOf(r)).sort(), d.files.map(f => f.id).sort(), tOf(d.settings), Object.keys(d.deleted || {}).length, d.gen]);
async function applyData(d, say, wholesale) {
  const [le, lf] = await Promise.all([dbAll("entries"), dbAll("files")]);
  const have = new Set(lf.map(f => f.id)), want = new Set(d.files.map(f => f.id));
  const missing = d.files.filter(f => !have.has(f.id)); let n = 0;
  for (const f of missing) { try { const b = await dbxDownload(f.path || filePath(f)); f._blob = new Blob([b], { type: f.type }); } catch (e) { if (!notFound(e)) throw e; } if (say && ++n % 5 === 0) say(`Downloading receipts ${n} of ${missing.length}…`); }
  _quiet++;
  try {
    const lm = new Map(le.map(r => [r.id, r])), nm = new Set(d.entries.map(r => r.id));
    for (const r of d.entries) { const c = lm.get(r.id); if (!c || tOf(c) !== tOf(r) || wholesale) await dbPut("entries", r); }
    for (const r of le) if (!nm.has(r.id)) await dbDel("entries", r.id);
    for (const f of lf) if (!want.has(f.id)) await dbDel("files", f.id);
    for (const f of missing) if (f._blob) await dbPut("files", { id: f.id, type: f.type, name: f.name, blob: f._blob });
  } finally { _quiet--; }
  if (missing.length || lf.some(f => !want.has(f.id))) { for (const u of Object.values(S.urls)) URL.revokeObjectURL(u); S.urls = {}; }
  if (d.settings) S.meta.settings = d.settings;
  S.meta.tomb = d.deleted || {}; S.meta.gen = d.gen || S.meta.gen;
  const sent = new Set(S.meta.sentFiles || []); for (const f of d.files) if (!missing.includes(f) || f._blob) sent.add(f.id); S.meta.sentFiles = [...sent];
  await saveMeta(); await reload();
}
async function pushLive(mode, data) {
  const seq = S.meta.seq, files = await dbAll("files");
  await pushFiles(files);
  if (!S.meta.gen) S.meta.gen = uid("g");
  const res = await dbxUpload(LIVE, wrap(data || await localData(files)), mode || (S.meta.dbxRev ? { ".tag": "update", update: S.meta.dbxRev } : "add"));
  S.meta.dbxRev = res.rev; S.meta.lastSync = Date.now(); S.meta.syncError = null; S.meta.conflict = null; S.meta.genPending = false;
  if (S.meta.seq === seq) { S.meta.dirty = false; S.meta.changes = 0; }
  await saveMeta();
}
async function adoptRemote() {
  const rm = await dbxMeta(LIVE); if (!rm) return;
  const d = readPayload(JSON.parse(await (await dbxDownload(LIVE)).text()));
  await applyData(d, null, true); S.meta.gen = d.gen;
  S.meta.dbxRev = rm.rev; S.meta.dirty = false; S.meta.changes = 0; S.meta.seq = (S.meta.seq || 0) + 1; S.meta.conflict = null; S.meta.genPending = false; S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta();
  refreshScreen();
}
function refreshScreen() { if (!S.sheet) render(); else if (S.sheet.kind === "backup") renderSheet(); else paintStatus(); }
function scheduleSync(ms = 4000) { clearTimeout(syncT); if (dbxOn()) syncT = setTimeout(() => dbxSync(), ms); }
async function syncOnce() {
  const rm = await dbxMeta(LIVE);
  if (!rm) { if (hasData() || S.meta.dirty) await pushLive("add"); else { S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta(); } return "pushed"; }
  if (rm.rev === S.meta.dbxRev && !S.meta.dirty && !S.meta.genPending) { S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta(); return "none"; }
  const R = readPayload(JSON.parse(await (await dbxDownload(LIVE)).text()));
  if (S.meta.genPending) { try { await dbxApi("files/copy_v2", { from_path: LIVE, to_path: snapName("replaced"), autorename: true }); } catch {} await pushLive({ ".tag": "update", update: rm.rev }); return "pushed"; }
  if (S.meta.gen && R.gen && R.gen !== S.meta.gen) {
    if (S.meta.dirty) { S.meta.conflict = { rev: rm.rev, when: rm.server_modified }; await saveMeta(); return "conflict"; }
    await adoptRemote(); return "adopted";
  }
  const L = await localData(), M = mergeData(L, R);
  if (sig(M) !== sig(L)) await applyData(M);
  if (sig(M) !== sig(R) || S.meta.dirty) await pushLive({ ".tag": "update", update: rm.rev }, { ...(await localData()), gen: M.gen });
  else { S.meta.dbxRev = rm.rev; S.meta.lastSync = Date.now(); S.meta.syncError = null; S.meta.dirty = false; S.meta.changes = 0; S.meta.gen = M.gen; await saveMeta(); }
  if (sig(M) !== sig(L)) { refreshScreen(); return "merged"; }
  return "pushed";
}
async function dbxSync(opts = {}) {
  if (!dbxOn() || syncing) return;
  if (!navigator.onLine) { if (opts.manual) toast("You're offline. Changes will go to Dropbox when you're back online."); paintStatus(); return; }
  if (mobileBlocked() && !opts.manual) { paintStatus(); return; }
  syncing = true; lastCheck = Date.now(); paintStatus(); let ok = false, failed = false, res = "";
  const firstLoad = !hasData();
  try {
    for (let i = 0; i < 4; i++) { try { res = await syncOnce(); break; } catch (e) { if (e instanceof DbxErr && e.status === 409 && /conflict/.test(e.summary) && i < 3) { await sleep(400 + Math.random() * 800); continue; } throw e; } }
    ok = res !== "conflict";
    if (firstLoad && hasData()) toast(`${S.entries.length} records loaded from Dropbox`);
    else if (res === "merged" || res === "adopted") toast("Updated with changes from the other phone");
  } catch (e) {
    failed = true; S.meta.syncError = (!navigator.onLine || e instanceof TypeError) ? "Couldn't reach Dropbox. It will try again shortly." : String(e.message || e);
    await saveMeta(); if (opts.manual) toast(S.meta.syncError);
  } finally { syncing = false; }
  if (ok && opts.manual) toast("Dropbox is up to date");
  if (ok && hasData()) maybeSnapshot(false).catch(() => {});
  paintStatus(); if (S.sheet && S.sheet.kind === "backup") renderSheet(); else if (!S.sheet && (res === "merged" || res === "adopted" || firstLoad)) render();
  clearTimeout(retryT); if (failed && dbxOn()) retryT = setTimeout(() => dbxSync(), 120000);
  if (ok && S.meta.dirty) scheduleSync(1500);
}
async function maybeSnapshot(force) {
  const day = new Date().toDateString(); if (!force && S.meta.lastSnapDay === day) return;
  const files = await dbAll("files"); await pushFiles(files); const body = await payloadJSON(files), d = new Date();
  await dbxUpload(snapName(force ? "manual" : ""), body, "overwrite");
  await dbxUpload(`/archive/ourtax-${d.getFullYear()}-${p2(d.getMonth() + 1)}.json`, body, "overwrite"); // the last copy of each month
  S.meta.lastSnapDay = day; S.meta.lastSnap = Date.now(); await saveMeta();
  pruneSnapshots().catch(() => {});
}
async function pruneSnapshots() {
  const cut = Date.now() - 60 * 864e5, keepYears = (SET().retainYears || 7) + 1, acut = new Date(new Date().getFullYear() - keepYears, new Date().getMonth(), 1).getTime();
  for (const e of await dbxList("/snapshots")) { const m = e.name.match(/(\d{4})-(\d{2})-(\d{2})/); if (e[".tag"] === "file" && m && new Date(+m[1], m[2] - 1, +m[3]).getTime() < cut) { try { await dbxApi("files/delete_v2", { path: e.path_lower }); } catch {} } }
  for (const e of await dbxList("/archive")) { const m = e.name.match(/(\d{4})-(\d{2})\.json$/); if (e[".tag"] === "file" && m && new Date(+m[1], m[2] - 1, 1).getTime() < acut) { try { await dbxApi("files/delete_v2", { path: e.path_lower }); } catch {} } }
}
async function snapshotBeforeReplace() { if (!dbxOn() || !hasData()) return true; try { const files = await dbAll("files"); await pushFiles(files); await dbxUpload(snapName("before-restore"), await payloadJSON(files), "overwrite"); return true; } catch (e) { toast("Couldn't save a snapshot to Dropbox first, so nothing was changed. Check you're online."); return false; } }
async function listSnapshots() {
  const el = $("#snapList"); if (!el) return; el.innerHTML = `<p class="small muted" style="margin:0">Looking in Dropbox…</p>`;
  try {
    const list = [...(await dbxList("/snapshots")), ...(await dbxList("/archive"))].filter(e => e[".tag"] === "file" && /\.json$/i.test(e.name)).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)));
    el.innerHTML = list.length ? `<div class="list">${list.slice(0, 80).map(e => `<div class="li" style="cursor:default"><span class="t"><b>${esc(fmtWhen(e.server_modified))}</b><span>${/archive/.test(e.path_lower) ? "Monthly archive · " : /before-restore/.test(e.name) ? "Saved before a restore · " : /replaced/.test(e.name) ? "Dropbox copy that was replaced · " : /manual/.test(e.name) ? "Snapshot now · " : "Daily · "}${(e.size / 1024).toFixed(0)} KB</span></span><button type="button" class="btn sm" data-act="dbxUse" data-path="${esc(e.path_lower)}">Use this</button></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">No snapshots in Dropbox yet.</p>`;
  } catch (e) { el.innerHTML = `<p class="small" style="color:var(--bad);margin:0">Couldn't list Dropbox snapshots: ${esc(e.message || e)}</p>`; }
}
async function useSnapshot(path) {
  if (!navigator.onLine) { toast("You're offline."); return; }
  if (!confirm("Use this snapshot? It replaces the records on both phones. The current copy is saved as a snapshot first.")) return;
  try {
    const d = readPayload(JSON.parse(await (await dbxDownload(path)).text()));
    if (!(await snapshotBeforeReplace())) return;
    await applyData(d, null, true);
    S.meta.conflict = null; S.meta.gen = uid("g"); S.meta.genPending = true; markDirty(); closeSheet();
    toast(`Snapshot restored: ${S.entries.length} records`);
  } catch (e) { toast("That snapshot couldn't be used: " + (e.message || e)); }
}
async function resolveConflict(useDropbox) {
  if (!navigator.onLine) { toast("You're offline. Try again when you're online."); return; }
  syncing = true; paintStatus();
  try {
    if (useDropbox) { if (hasData()) { const files = await dbAll("files"); await pushFiles(files); await dbxUpload(snapName("before-restore"), await payloadJSON(files), "overwrite"); } syncing = false; await adoptRemote(); toast("Using the Dropbox copy. This phone's copy was saved as a snapshot."); }
    else { try { await dbxApi("files/copy_v2", { from_path: LIVE, to_path: snapName("replaced"), autorename: true }); } catch {} S.meta.gen = uid("g"); await pushLive("overwrite"); toast("Kept this phone's copy. The Dropbox copy was saved as a snapshot."); }
  } catch (e) { toast("That didn't work: " + (e.message || e)); }
  syncing = false; paintStatus(); if (S.sheet) renderSheet(); else render();
}
async function dbxDisconnect() {
  try { await dbxApi("auth/token/revoke"); } catch {}
  S.meta.dbx = null; S.meta.dbxRev = null; S.meta.conflict = null; S.meta.syncError = null; S.meta.sentFiles = []; await saveMeta();
  clearTimeout(syncT); paintStatus(); renderSheet(); toast("Dropbox disconnected. Everything already in Dropbox is kept.");
}
function dropboxPanel() {
  const m = S.meta;
  if (!dbxOn()) return `<div class="card" id="dbxPanel"><h3>Dropbox</h3>
    <p style="margin:0" class="small">Connect Dropbox and every record and receipt is kept there as well as on this phone, and shared with the other phone. Changes go when you're on Wi‑Fi; a full snapshot is saved each day and one copy per month is kept for ${SET().retainYears + 1} years.</p>
    <p style="margin:0" class="small">Use the <b>same Dropbox account</b> on both phones. If a phone is lost, cleared or replaced, connect Dropbox on the new one and everything comes back.</p>
    ${DBX_APP_KEY ? "" : `<div class="field"><label for="dbxKey">Dropbox App key</label><input id="dbxKey" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(m.dbxKey || "")}" placeholder="from the Dropbox App Console"><span class="hint">Redirect URI to enter in the App Console: <b>${esc(DBX_REDIRECT)}</b></span></div>`}
    <div class="row"><button type="button" class="btn primary" data-act="dbxConnect">Connect Dropbox</button></div>
    <p class="xs muted" style="margin:0">Our Tax can only see its own folder in Dropbox › Apps. It can't see anything else in your Dropbox.</p></div>`;
  const st = syncText();
  return `${m.conflict ? `<div class="card" style="border:2px solid var(--warn)"><h3>Which copy do you want to keep?</h3><p style="margin:0" class="small">Dropbox has a copy saved ${m.conflict.when ? fmtWhen(m.conflict.when) : "recently"} that's different from this phone, and this phone has changes that haven't been sent yet. Whichever you don't keep is saved as a snapshot first.</p><div class="row"><button type="button" class="btn primary" data-act="conflictDropbox">Use the Dropbox copy</button><button type="button" class="btn" data-act="conflictPhone">Keep this phone's copy</button></div></div>` : ""}
  <div class="card" id="dbxPanel"><h3>Dropbox</h3>
    <dl class="kv"><dt>Status</dt><dd id="dbxStatus">${esc(cap1(st.t.replace(" · tap", "")))}</dd><dt>Last sync</dt><dd>${esc(fmtWhen(m.lastSync))}</dd><dt>Last snapshot</dt><dd>${esc(fmtWhen(m.lastSnap))}</dd></dl>
    ${m.syncError ? `<div class="banner bad"><span>${esc(m.syncError)}</span></div>` : ""}
    <div class="row"><button type="button" class="btn primary" data-act="dbxSyncNow" ${syncing ? "disabled" : ""}>Sync now</button><button type="button" class="btn" data-act="dbxSnap">Snapshot now</button></div>
    <label class="check"><input type="checkbox" id="wifiOnly" ${wifiOnly() ? "checked" : ""}> Only sync on Wi‑Fi (Sync now still works on mobile data)</label>
    <div class="row"><button type="button" class="btn" data-act="dbxList">Restore a Dropbox snapshot…</button><button type="button" class="btn danger" data-act="dbxDisconnect">Disconnect</button></div>
    <div id="snapList"></div>
    <p class="xs muted" style="margin:0">In Dropbox › Apps › your Our Tax folder: <b>live</b> is the current copy (with receipts in <b>files</b>), <b>snapshots</b> holds one copy per day for 60 days, and <b>archive</b> holds one copy per month for ${SET().retainYears + 1} years.</p></div>`;
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, v = el.dataset.v, f = S.sheet && S.sheet.f;
  switch (act) {
    case "tab": S.tab = v; render(); scrollTo(0, 0); break;
    case "setMe": S.meta.me = v; if (!S.who || S.who !== "all") S.who = v; S.sumWho = null; await saveMeta(); render(); break;
    case "who": S.who = v; render(); break;
    case "sumWho": S.sumWho = v; render(); break;
    case "recType": S.rec.type = v; render(); break;
    case "recWho": S.rec.who = v; render(); break;
    case "addTrip": openSheet({ kind: "trip", f: newTrip(), keepScroll: false }); break;
    case "addExpense": openSheet({ kind: "expense", f: newExpense(), keepScroll: false }); break;
    case "openEntry": openEntry(el.dataset.id); break;
    case "closeSheet": cancelSheet(); break;
    case "fPerson": f.person = v; renderSheet(); break;
    case "fPlace": f.placeId = v; if (v !== "other") { const p = placeById(v); f.km = p ? p.km : f.km; } else if (S.sheet.kind === "trip" && !S.sheet.id) f.km = ""; renderSheet(); break;
    case "fMode": f.mode = v; if (v === "range" && f.from === f.to) { const d = parseISO(f.date), w = d.getDay(), mon = addDays(f.date, w === 0 ? -6 : 1 - w); f.from = mon; f.to = addDays(mon, 4); } renderSheet(); break;
    case "fDay": f.date = v; renderSheet(); break;
    case "fPurpose": f.purpose = v; renderSheet(); break;
    case "newPurpose": { const n = (prompt("New purpose (it's saved for next time)") || "").trim(); if (n) { const st = clone(SET()); if (!st.purposes.includes(n)) { st.purposes.push(n); await saveSettings(st); } f.purpose = n; renderSheet(); } break; }
    case "fCat": f.catId = v; renderSheet(); break;
    case "saveTrip": el.disabled = true; try { await saveTrip(); } finally { el.disabled = false; } break;
    case "saveExpense": el.disabled = true; try { await saveExpense(); } finally { el.disabled = false; } break;
    case "dropFile": f.files = f.files.filter(x => x !== el.dataset.id); paintThumbs(); break;
    case "removeEntry": setRemoved(true); break;
    case "restoreEntry": setRemoved(false); break;
    case "purgeEntry": purgeEntry(); break;
    case "rulesEdit": openRules(el.dataset.id); break;
    case "rulesNew": openRules(v, true); break;
    case "rulesSave": rulesSave(); break;
    case "rulesDelete": { if (confirm(`Delete the ${f.fy} rules?`)) { const st = clone(SET()); delete st.rules[f.fy]; await saveSettings(st); closeSheet(); } break; }
    case "editItem": openItem(el.dataset.id); break;
    case "itemSave": itemSave(); break;
    case "itemDelete": itemDelete(); break;
    case "report": openSheet({ kind: "report", f: { fy: S.fy, person: (S.sumWho && S.sumWho !== "all") ? S.sumWho : S.meta.me, tripLog: true, photos: false } }); break;
    case "rpPerson": f.person = v; renderSheet(); break;
    case "makePdf": el.disabled = true; try { await makePdf(); } catch (err) { toast("Couldn't make the PDF: " + (err.message || err)); } el.disabled = false; break;
    case "goBackup": if (!S.meta.me) break; openSheet({ kind: "backup" }); break;
    case "backupFile": backupFile(); break;
    case "dbxConnect": el.disabled = true; try { await dbxConnect(); } catch (err) { toast("Couldn't start Dropbox sign-in: " + (err.message || err)); } el.disabled = false; break;
    case "dbxSyncNow": dbxSync({ manual: true }); break;
    case "dbxSnap": el.disabled = true; maybeSnapshot(true).then(() => { toast("Snapshot saved to Dropbox"); renderSheet(); }).catch(x => { el.disabled = false; toast("Snapshot didn't save: " + (x.message || x)); }); break;
    case "dbxList": listSnapshots(); break;
    case "dbxUse": useSnapshot(el.dataset.path); break;
    case "conflictDropbox": resolveConflict(true); break;
    case "conflictPhone": resolveConflict(false); break;
    case "dbxDisconnect": if (confirm("Disconnect Dropbox? Everything already in Dropbox is kept, but new changes will only be on this phone.")) dbxDisconnect(); break;
    case "sampleLoad": await loadSample(); break;
    case "sampleRemove": if (confirm("Remove all the 2025-26 sample records? Your own records aren't touched.")) await removeSample(); break;
    case "checkUpdate": { toast("Checking…"); try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch {} setTimeout(() => location.reload(), 800); break; }
  }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "recQ") { S.rec.q = t.value; const l = $("#recList"); if (l) l.innerHTML = recListHTML(); return; }
  if (!S.sheet || !t.dataset) return;
  if (t.dataset.f && t.type !== "checkbox" && t.tagName !== "SELECT") { S.sheet.f[t.dataset.f] = t.value; liveUpdate(t.dataset.f); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "wifiOnly") { S.meta.wifiOnly = t.checked; await saveMeta(); paintStatus(); if (!t.checked) dbxSync(); return; }
  if (t.dataset && t.dataset.set === "fy") { S.fy = t.value; render(); return; }
  if (t.id === "recRemoved") { S.rec.removed = t.checked; render(); return; }
  if (t.id === "eFile") { await addFiles([...t.files]); t.value = ""; return; }
  if (t.id === "restoreIn") { if (t.files[0]) await restoreFile(t.files[0]); t.value = ""; return; }
  if (!S.sheet) return;
  if (t.dataset.cat) { const s = new Set(S.sheet.f.stdCats); t.checked ? s.add(t.dataset.cat) : s.delete(t.dataset.cat); S.sheet.f.stdCats = [...s]; return; }
  if (t.dataset.f) { S.sheet.f[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; if (t.type === "checkbox" || t.tagName === "SELECT" || t.type === "date") { if (["date", "from", "to", "weekdays", "pct", "fy"].includes(t.dataset.f) || t.type === "checkbox") renderSheet(); else liveUpdate(t.dataset.f); } }
});
function liveUpdate(k) {
  const sh = S.sheet, foot = $("#foot"); if (!sh) return;
  if (sh.kind === "trip") { if (foot) foot.innerHTML = tripFoot(); const ri = $("#rangeInfo"); if (ri) ri.textContent = rangeInfo(sh.f); }
  if (sh.kind === "expense") { if (foot) foot.innerHTML = expFoot(); const ih = $("#instHint"); if (ih) ih.textContent = instantHint(sh.f); const ch = $("#catHint"); if (ch) ch.textContent = catHint(sh.f); }
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) cancelSheet(); });
window.addEventListener("popstate", () => { if (S.sheet) cancelSheet(); });
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") { if (S.meta.dirty) dbxSync(); return; }
  const m = await dbGet("meta", "main").catch(() => null);
  if (m && (m.stamp || 0) > (S.meta.stamp || 0)) { await reload(); if (!S.sheet) render(); paintStatus(); }
  if (Date.now() - lastCheck > 60000) dbxSync();
});
window.addEventListener("online", () => dbxSync());
if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener("change", () => { paintStatus(); if (!mobileBlocked() && S.meta.dirty) dbxSync(); });

/* ================= starter records & sample data ================= */
/* fixed ids, so both phones adding them just merge into one copy; a later edit or removal on either phone wins */
const SEED_T = Date.parse("2026-10-21T08:45:00+11:00");
const SEEDS = [
  { id: "seed-2026-07-31-windsor", type: "trip", person: "p-shaun", date: "2026-07-31", placeId: "pl-windsor", place: "Windsor Court", km: 46, purpose: "Covering", carId: "car-yaris", car: "Toyota Yaris", notes: "Covering Windsor" },
  { id: "seed-2026-10-19-mtdruitt", type: "trip", person: "p-shaun", date: "2026-10-19", placeId: "pl-mtdruitt", place: "Mt Druitt Court", km: 30, purpose: "Court", carId: "car-yaris", car: "Toyota Yaris", notes: "" }
];
async function seedStarter() {
  if (S.meta.seeded1) return; const tomb = S.meta.tomb || {}; let n = 0;
  _quiet++;
  try { for (const s of SEEDS) { if (tomb[s.id] || await dbGet("entries", s.id)) continue; await dbPut("entries", { ...s, created: SEED_T, _t: SEED_T, log: [{ at: "2026-10-21T08:45:00+11:00", by: "Shaun", act: "Added when the app was set up" }] }); n++; } } finally { _quiet--; }
  S.meta.seeded1 = true; await saveMeta(); if (n) { await reload(); markDirty(); }
}
function sampleEntries() {
  const out = [], T = (date, place, km, purpose) => out.push({ type: "trip", person: "p-shaun", date, placeId: { "Mt Druitt Court": "pl-mtdruitt", "Windsor Court": "pl-windsor", "Blacktown Court": "pl-blacktown" }[place], place, km, purpose, carId: "car-yaris", car: "Toyota Yaris", notes: "" });
  for (const d of ["03", "04", "05", "06"]) T(`2026-03-${d}`, "Mt Druitt Court", 30, "Court");
  for (const wk of [9, 16, 23]) for (let i = 0; i < 5; i++) T(`2026-03-${p2(wk + i)}`, "Mt Druitt Court", 30, "Court");
  T("2026-04-13", "Windsor Court", 46, "Hearing"); T("2026-04-24", "Mt Druitt Court", 30, "Court"); T("2026-05-04", "Mt Druitt Court", 30, "Bail Court");
  T("2026-05-07", "Windsor Court", 46, "List"); T("2026-05-08", "Windsor Court", 46, "Hearing"); T("2026-05-24", "Mt Druitt Court", 30, "Hearing");
  T("2026-05-29", "Blacktown Court", 52, "Hearing"); T("2026-06-19", "Windsor Court", 46, "Part heard");
  const E = (person, date, catId, desc, amount, basis) => out.push({ type: "expense", person, date, catId, cat: catName(catId), desc, amount, pct: 100, basis: basis || "", notes: "", files: [] });
  E("p-shaun", "2026-06-30", "cat-uniform", "Drycleaning ($26 × 3)", 78); E("p-shaun", "2026-06-30", "cat-uniform", "Laundry", 10);
  E("p-shaun", "2026-06-30", "cat-union", "Police Association fees", 1517.88);
  E("p-shaun", "2026-06-30", "cat-work", "Phone calls & internet while at work", 54, "Claimed at 23% (1,976 work hrs of 8,736 per year)");
  E("p-shaun", "2026-06-30", "cat-other", "Police Provident Fund", 78);
  E("p-shaun", "2025-08-14", "cat-work", "Mouse", 113.05); E("p-shaun", "2026-06-16", "cat-work", "Electric stapler for office", 120.41); E("p-shaun", "2025-08-14", "cat-work", "Keyboard", 175.75);
  E("p-shaun", "2025-08-15", "cat-work", "Ergonomic mouse pad", 45); E("p-shaun", "2025-08-15", "cat-work", "Headphones stand", 19.99);
  E("p-shaun", "2026-06-23", "cat-agent", "Positive Tax", 328.75); E("p-lyndsey", "2026-06-23", "cat-agent", "Positive Tax", 328.75);
  E("p-shaun", "2025-07-30", "cat-agent", "2024-25 return preparation", 15); E("p-shaun", "2026-06-30", "cat-work", "Pen refills", 20);
  E("p-lyndsey", "2025-09-08", "cat-donation", "Suncorp – Tour de Cure (Spirit to Cure)", 50);
  return out.map((e, i) => ({ ...e, id: `sample-2526-${p2(i)}`, sample: true, created: SEED_T + i }));
}
async function loadSample() {
  const at = new Date().toISOString(), by = pName(S.meta.me);
  for (const e of sampleEntries()) await dbPut("entries", { ...e, log: [{ at, by, act: "Loaded as sample data" }] });
  await reload(); S.fy = "2025-26"; S.tab = "summary"; render(); toast("2025-26 sample loaded — see the Summary");
}
async function removeSample() { for (const e of S.entries.filter(x => x.sample)) await dbDel("entries", e.id); await reload(); render(); toast("Sample records removed"); }

/* ================= boot ================= */
async function saveMeta() { S.meta.stamp = Date.now(); await tx("meta", "readwrite", os => os.put({ id: "main", ...S.meta })); }
async function reload() { S.entries = await dbAll("entries"); const m = await dbGet("meta", "main"); S.meta = m ? (({ id, ...r }) => r)(m) : {}; }
(async () => {
  try { await openDB(); } catch (e) { $("#main").innerHTML = `<section class="view"><div class="empty">This browser can't store data for the app (private mode or storage blocked). Open it in normal Chrome.</div></section>`; return; }
  await reload();
  if (!S.meta.deviceId) { S.meta.deviceId = uid("dev"); S.meta.created = todayISO(); await saveMeta(); }
  await seedStarter();
  S.fy = fyOf(todayISO()); S.who = S.meta.me || null;
  render();
  if (await dbxReturn()) { render(); if (S.meta.me) openSheet({ kind: "backup" }); }
  dbxSync();
  const q = new URLSearchParams(location.search).get("add"); if (q && S.meta.me) openSheet({ kind: q === "expense" ? "expense" : "trip", f: q === "expense" ? newExpense() : newTrip() });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
