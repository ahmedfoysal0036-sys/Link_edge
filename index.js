const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

console.log("🛠 Data getting to server...");

// ---------- Firebase ----------
let serviceAccount;
try {
    if (process.env.FIREBASE_CONFIG) {
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        serviceAccount = require("./firebase-adminsdk.json");
    }
} catch (e) {
    console.error("❌ Firebase Config Loading Failed:", e.message);
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://phoenixdatabase-v1-default-rtdb.firebaseio.com/"
    });
}
const db = admin.database();

// ---------- Bot token (env theke) ----------
function loadBotToken() {
    const hit = Object.keys(process.env).find(k =>
        /^(BOT[_ ]?TOKEN|TELEGRAM[_ ]?(BOT[_ ]?)?TOKEN|TOKEN)$/i.test(k.trim())
    );
    let t = hit ? process.env[hit] : '';

    if (!t) {
        for (const p of ['/etc/secrets/BOT_TOKEN', './BOT_TOKEN']) {
            try { t = fs.readFileSync(p, 'utf8'); if (t) break; } catch (_) {}
        }
    }
    return (t || '').trim().replace(/^["']|["']$/g, '').trim();
}

const BOT_TOKEN = loadBotToken();

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN paoa jay nai.");
    process.exit(1);
}
if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(BOT_TOKEN)) {
    console.error("❌ BOT_TOKEN er format sothik na.");
    process.exit(1);
}
console.log("🔑 BOT_TOKEN loaded (id: " + BOT_TOKEN.split(':')[0] + ")");

const bot = new Telegraf(BOT_TOKEN);
const BOT_VERSION = 'v4.1-merge-keyonly';
console.log("🤖 Phoenix Bot version: " + BOT_VERSION);

// =====================================================================
// MATCHING CORE START  (pure functions, no I/O)
// =====================================================================
const safeKey = (s) =>
    String(s || '')
        .replace(/[.#$\/\[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase()
        .slice(0, 200);

const esc = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const toArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

const str = (v) => (v === undefined || v === null ? '' : v.toString().trim());

const valueToString = (val) => {
    if (val && typeof val === 'object') val = Object.values(val).join(' | ');
    return val ? val.toString().trim() : '';
};

function normRow(r) {
    if (Array.isArray(r)) return r;
    if (r && typeof r === 'object') {
        const a = [];
        for (const k of Object.keys(r)) {
            const i = Number(k);
            if (Number.isInteger(i) && i >= 0 && i < 50) a[i] = r[k];
        }
        return a;
    }
    return null;
}

const R_TYPED  = /(^|[^A-Z0-9])([A-Z]{2,6})[_ -]([A-Z])(\d{2,5})(?!\d)/g;   
const R_REGION = /(^|[^A-Z0-9])([A-Z]{2,6})(\d{2,5})(?!\d)/g;                
const R_BARE   = /(^|[^A-Z0-9])([A-Z])(\d{3,5})(?!\d)/g;                     
const SEP = '\n— — —\n';

function parseIds(text) {
    let u = safeKey(text);
    const ids = [];
    u = u.replace(R_TYPED, (m, pre, reg, typ, num) => { ids.push({ reg, typ, num }); return pre + ' '; });
    u = u.replace(R_REGION, (m, pre, reg, num) => { ids.push({ reg, typ: '', num }); return pre + ' '; });
    u.replace(R_BARE, (m, pre, typ, num) => { ids.push({ reg: '', typ, num }); return pre + ' '; });
    return ids;
}
const idCode = (id) => id.reg + (id.typ ? (id.reg ? '_' : '') + id.typ : '') + id.num;
const typOk = (a, b) => !a || !b || a === b;   
const addTo = (m, k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };

function buildKeyIndex(keysObj) {
    const idx = { full: new Map(), core: new Map(), num: new Map() };
    for (const k of Object.keys(keysObj || {})) {
        const v = valueToString(keysObj[k]);
        if (!v) continue;
        addTo(idx.full, safeKey(k), { v });
        for (const id of parseIds(k)) {
            const e = { v, id, code: idCode(id) };
            if (id.reg) addTo(idx.core, id.reg + id.num, e);
            if (id.num.length >= 4) addTo(idx.num, id.num, e);
        }
    }
    return idx;
}

function lookupKeys(siteName, idx) {
    const precise = new Set(), weak = new Map();
    (idx.full.get(safeKey(siteName)) || []).forEach(e => precise.add(e.v));
    for (const tok of safeKey(siteName).split(/[^A-Z0-9]+/)) {
        if (tok.length >= 5) (idx.full.get(tok) || []).forEach(e => precise.add(e.v));
    }
    for (const mi of parseIds(siteName)) {
        if (mi.reg) (idx.core.get(mi.reg + mi.num) || []).forEach(e => { if (typOk(mi.typ, e.id.typ)) precise.add(e.v); });
        if (mi.num.length >= 4) (idx.num.get(mi.num) || []).forEach(e => {
            if ((!mi.reg || !e.id.reg) && typOk(mi.typ, e.id.typ)) weak.set(e.v, e.code);
        });
    }
    if (precise.size) return [...precise].join(SEP);
    if (weak.size) return [...weak].map(([v, c]) => `(≈ ${c}) ${v}`).join(SEP);
    return null;
}

const SEARCH_COLS = [0, 1, 2, 3, 4, 7];

function buildMasterIndex(masterVal) {
    const out = [];
    for (const raw of toArray(masterVal).slice(1)) {
        const row = normRow(raw);
        if (!row) continue;
        const name = str(row[0]);
        const ids = parseIds(name);
        const aliases = new Set([safeKey(name)]);
        ids.forEach(id => { aliases.add(idCode(id)); if (id.reg) aliases.add(id.reg + id.num); aliases.add(id.num); });
        out.push({
            row, name, ids, aliases,
            nameU: name.toUpperCase(),
            hay: [...SEARCH_COLS.map(i => str(row[i]).toUpperCase()), ...aliases].join(' | ')
        });
    }
    return out;
}

function searchRows(index, query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const q = tokens.join(' ');
    const qid = tokens.length === 1 ? parseIds(q) : [];
    const qi = qid.length === 1 && qid[0].num.length >= 4 ? qid[0] : null;
    const hits = [];
    for (const e of index) {
        const textHit = tokens.every(t => e.hay.includes(t));
        const idHit = !textHit && qi && e.ids.some(m =>
            m.num === qi.num && (!m.reg || !qi.reg || m.reg === qi.reg) && typOk(m.typ, qi.typ));
        if (!textHit && !idHit) continue;
        let score = 3;
        if (e.nameU === q || e.aliases.has(q)) score = 0;
        else if (e.nameU.startsWith(q)) score = 1;
        else if (e.nameU.includes(q)) score = 2;
        else if (idHit) score = 2.5;
        hits.push({ e, score });
    }
    hits.sort((a, b) => a.score - b.score);
    return hits.map(h => h.e);
}
// =====================================================================
// MATCHING CORE END
// =====================================================================

// ---------- Key-only: key ache kintu BTS data (master) e site nai ----------
function buildKoIndex(keysObj, names) {
    const full = new Set(), toks = new Set(), core = new Map(), num = new Map();
    for (const n of names) {
        if (!n) continue;
        const sk = safeKey(n);
        full.add(sk);
        sk.split(/[^A-Z0-9]+/).forEach(t => { if (t.length >= 5) toks.add(t); });
        for (const id of parseIds(n)) {
            if (id.reg) addTo(core, id.reg + id.num, id);
            if (id.num.length >= 4) addTo(num, id.num, id);
        }
    }
    const groups = new Map();
    for (const k of Object.keys(keysObj || {})) {
        const v = valueToString(keysObj[k]);
        if (!v) continue;
        const sk = safeKey(k), ids = parseIds(k);
        let hit = full.has(sk) || toks.has(sk);
        if (!hit) for (const id of ids) {
            if (id.reg && (core.get(id.reg + id.num) || []).some(m => typOk(id.typ, m.typ))) { hit = true; break; }
            if (id.num.length >= 4 && (num.get(id.num) || []).some(m => (!id.reg || !m.reg) && typOk(id.typ, m.typ))) { hit = true; break; }
        }
        if (hit) continue;
        const g = groups.get(v) || { name: k, names: [], v, ids: [] };
        g.names.push(k); ids.forEach(i => g.ids.push(i));
        groups.set(v, g);
    }
    return [...groups.values()].map(g => {
        const aliases = new Set(g.names.map(safeKey));
        g.ids.forEach(id => { aliases.add(idCode(id)); if (id.reg) aliases.add(id.reg + id.num); aliases.add(id.num); });
        return { row: [], name: g.name, ids: g.ids, aliases, nameU: g.name.toUpperCase(), hay: [...aliases].join(' | '), ko: true, v: g.v };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

const state = {
    koIndex: [],
    keyVal: {},
    index: [],
    keyIdx: buildKeyIndex({}),
    keyCount: 0,
    masterReady: false,
    keysReady: false
};

function refreshKeyOnly() {
    try { state.koIndex = buildKoIndex(state.keyVal, state.index.map(e => e.name)); }
    catch (e) { console.error("Key-only index error:", e.message); }
}

db.ref('professor_master_db').on('value', (snap) => {
    try {
        state.index = buildMasterIndex(snap.val());
        state.masterReady = true;
        refreshKeyOnly();
        console.log(`📦 Master synced: ${state.index.length} rows`);
    } catch (e) {
        console.error("Master index error:", e.message);
    }
}, (err) => console.error("Master listener error:", err.message));

db.ref('professor_keys_db').on('value', (snap) => {
    try {
        const v = snap.val() || {};
        state.keyIdx = buildKeyIndex(v);
        state.keyCount = Object.keys(v).length;
        state.keyVal = v;
        refreshKeyOnly();
        state.keysReady = true;
        console.log(`🔑 Keys synced: ${state.keyCount} keys`);
    } catch (e) {
        console.error("Key index error:", e.message);
    }
}, (err) => console.error("Keys listener error:", err.message));

// ---------- Telegram helpers ----------
const MAX_RESULTS = 5;
const MAX_MSG = 3900;

async function sendHtml(ctx, html) {
    try {
        await ctx.reply(html, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
        console.log("Format Error:", err.message);
        const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        await ctx.reply(plain.slice(0, 4000), { disable_web_page_preview: true }).catch(() => {});
    }
}

bot.command('version', async (ctx) => {
    await ctx.reply(
        `🤖 Bot version: ${BOT_VERSION}\n` +
        `📋 Sites in cache: ${state.index.length}\n` +
        `🔑 Total keys in DB: ${state.keyCount}\n` +
        `🔗 Key-only (BTS data nai): ${state.koIndex.length}\n` +
        `✅ Ready: ${state.masterReady && state.keysReady ? 'yes' : 'loading...'}`
    );
});

bot.on('text', async (ctx) => {
    let rawQuery = ctx.message.text.toUpperCase().trim();
    if (rawQuery.startsWith('/')) return;

    let isKeyOnly = false;
    if (/^KEY[:\s]/.test(rawQuery) || /\sKEY$/.test(rawQuery)) {
        isKeyOnly = true;
        rawQuery = rawQuery.replace(/^KEY:?\s*/, '').replace(/\s*KEY$/, '').trim();
    }

    const query = rawQuery.replace(/\s+/g, ' ');
    if (!query) return;

    if (!state.masterReady || !state.keysReady) {
        return ctx.reply('⏳ Database load hocche, 5-10 second por abar try korun.');
    }
    if (state.index.length === 0 && state.koIndex.length === 0) {
        return ctx.reply('❌ Master Database is empty.');
    }

    try {
        const results = searchRows(state.index, query).concat(searchRows(state.koIndex, query));

        if (results.length === 0) {
            return sendHtml(ctx, `❌ No match found for: <b>${esc(query)}</b>`);
        }

        const shownList = results.slice(0, MAX_RESULTS);
        const header = `✅ <b>Found ${results.length} results</b>` +
            (results.length > MAX_RESULTS ? ` (showing top ${MAX_RESULTS})` : '') + `\n\n`;

        const blocks = shownList.map(({ row: r, name, ko, v: koVal }) => {
            const ip = str(r[1]) || '-';
            const subCenter = str(r[2]) || '-';
            const nodeAddr = str(r[3]) || '-';
            const model = str(r[4]) || '-';
            const lat = str(r[5]) || '0';
            const long = str(r[6]) || '0';
            const client = str(r[7]) || '-';

            const mapLink = (lat !== '0' && long !== '0')
                ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(long)}` : null;

            let keyInfo = ko ? unesc(koVal) : unesc(lookupKeys(name, state.keyIdx) || 'No key info available');
            if (keyInfo.length > 900) keyInfo = keyInfo.slice(0, 900) + ' ...';

            let b = '';
            if (ko) {
                b += `📌 <b>Site:</b> ${esc(name) || '-'} ⚠️ <i>BTS data nai</i>\n`;
                b += `<b>Key information:</b>\n<i>${esc(keyInfo)}</i>\n`;
            } else if (isKeyOnly) {
                b += `<b>Site name:</b> ${esc(name) || '-'}\n`;
                b += `<b>Key information:</b>\n<i>${esc(keyInfo)}</i>\n`;
            } else {
                b += `📌 <b>Site:</b> ${esc(name) || '-'}\n`;
                b += `🌐 <b>IP:</b> <code>${esc(ip)}</code>\n`;
                b += `🏢 <b>Client:</b> ${esc(client)}\n`;
                b += `🏙 <b>Sub-Center:</b> ${esc(subCenter)}\n`;
                b += `🛠 <b>Model:</b> ${esc(model)}\n`;
                b += `📍 <b>Node:</b> ${esc(nodeAddr)}\n`;
                if (mapLink) {
                    b += `🌍 <b>Location:</b> <a href="${mapLink}">${esc(lat)}, ${esc(long)}</a>\n`;
                }
                b += `<b>Key information:</b>\n<i>${esc(keyInfo)}</i>\n`;
            }
            return b + `────────────────\n`;
        });

        let response = header;
        let included = 0;
        for (const b of blocks) {
            if (response.length + b.length > MAX_MSG) break;
            response += b;
            included++;
        }
        const hidden = results.length - included;
        if (hidden > 0) {
            response += `<i>+ ${hidden} more results. Aro specific likhun (jemon full site code).</i>`;
        }

        await sendHtml(ctx, response);

    } catch (err) {
        console.error("Search Error:", err.message);
        ctx.reply('⚠️ Error fetching data.').catch(() => {});
    }
});

bot.catch((err) => console.error("Bot handler error:", err.message));

// ---------- Keep-alive + secure web API ----------
const MASTER_PIN = String(process.env.MASTER_PIN || '').trim();
if (!MASTER_PIN) { console.error("❌ MASTER_PIN env set kora nai (Render > Environment e boshan)."); process.exit(1); }
const TG_CHAT_ID = process.env.TG_CHAT_ID || '682844989';
const UIDS = { admin: 'phoenix-admin', user: 'phoenix-user' };
const uidFor = (key) => 'u_' + String(key).slice(0, 100);
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const pinOk = (p) => crypto.timingSafeEqual(sha(p), sha(MASTER_PIN));

const scrypt = (pin, salt) => new Promise((ok, no) => crypto.scrypt(String(pin), salt, 32, (e, k) => (e ? no(e) : ok(k))));
async function hashPin(pin) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(pin, salt);
    return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}
async function checkHash(pin, rec) {
    if (!rec || !rec.salt || !rec.hash) return false;
    try {
        const got = await scrypt(pin, Buffer.from(rec.salt, 'base64'));
        const want = Buffer.from(rec.hash, 'base64');
        return got.length === want.length && crypto.timingSafeEqual(got, want);
    } catch (_) { return false; }
}

async function roleForPin(pin) {
    pin = String(pin || '').trim();
    if (!pin) return null;
    if (pinOk(pin)) return { role: 'admin', name: 'Master Admin', uid: UIDS.admin, master: true };
    let users = {};
    try { users = (await db.ref('app_config/users').once('value')).val() || {}; }
    catch (e) { console.error('Users store read error:', e.message); }
    for (const [key, urec] of Object.entries(users)) {
        if (await checkHash(pin, urec)) {
            return { role: urec.role === 'admin' ? 'admin' : 'user', name: urec.name || key, uid: uidFor(key), key, blocked: !!urec.blocked };
        }
    }
    return null;
}

async function logActivity(role, action, site, detail, name) {
    try {
        await db.ref('activity_log').push({
            ts: admin.database.ServerValue.TIMESTAMP,
            role, action, name: String(name || '').slice(0, 60), site: site || '', detail: String(detail || '').slice(0, 600)
        });
    } catch (e) { console.error('Log error:', e.message); }
}

const fails = new Map();
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const isLocked = (ip) => { const f = fails.get(ip); return !!(f && f.until && f.until > Date.now()); };
function noteFail(ip) {
    const f = fails.get(ip) || { n: 0, until: 0 };
    if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
    f.n++;
    if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
    fails.set(ip, f);
}
setInterval(() => { const t = Date.now(); for (const [k, f] of fails) if (!f.until && f.n === 0 || (f.until && f.until < t)) fails.delete(k); }, 600000);

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const u = new URL(req.url || '/', 'http://localhost');
    try {
        if (req.method === 'POST' && u.pathname === '/auth/pin') {
            const ip = clientIp(req);
            if (isLocked(ip)) return sendJson(res, 429, { error: 'locked' });
            let body = {};
            try { body = JSON.parse((await readBody(req, 2000)).toString() || '{}'); } catch (_) {}
            
            const authResult = body.pin ? await roleForPin(body.pin) : null;
            if (!authResult) {
                noteFail(ip);
                logActivity('none', 'login_failed', '', ip);
                return sendJson(res, 401, { error: 'wrong pin' });
            }
            if (authResult.blocked) {
                logActivity('none', 'login_blocked', authResult.name, ip);
                return sendJson(res, 403, { error: 'blocked' });
            }
            const { role, name: userName, uid } = authResult;
            fails.delete(ip);
            if (body.check) return sendJson(res, 200, { ok: true, role, userName });

            const token = await admin.auth().createCustomToken(uid, { role, name: userName });
            logActivity(role, 'login', '', ip, userName);
            return sendJson(res, 200, { token, role, userName });
        }

        if (req.method === 'POST' && u.pathname === '/admin/users') {
            const ip = clientIp(req);
            if (isLocked(ip)) return sendJson(res, 429, { error: 'locked' });
            const dec = await adminReq(req);
            if (!dec) return sendJson(res, 401, { error: 'unauthorized' });

            let body = {};
            try { body = JSON.parse((await readBody(req, 2000)).toString() || '{}'); } catch (_) {}
            const { action, username, newPin, role, currentAdminPin } = body;
            const usersRef = db.ref('app_config/users');
            const byName = dec.name || 'admin';

            if (action === 'list') {
                const all = (await usersRef.once('value')).val() || {};
                return sendJson(res, 200, { users: Object.entries(all).map(([k, v]) => ({
                    key: k, name: v.name || k, role: v.role === 'admin' ? 'admin' : 'user',
                    blocked: !!v.blocked, updatedAt: v.updatedAt || 0 })) });
            }

            const who = await roleForPin(currentAdminPin);
            if (!who || who.role !== 'admin' || who.blocked) {
                noteFail(ip);
                return sendJson(res, 401, { error: 'Current Admin PIN thik na' });
            }
            fails.delete(ip);

            const ukey = safeKey(username).toLowerCase();
            if (!username || !ukey) return sendJson(res, 400, { error: 'Username nai' });
            const uid = uidFor(ukey);
            const bref = db.ref('app_config/blocked/' + uid);
            const revoke = () => admin.auth().revokeRefreshTokens(uid).catch(() => {});

            if (action === 'add') {
                if (!/^\d{6}$/.test(String(newPin || ''))) return sendJson(res, 400, { error: '6-digit PIN din' });
                const clash = await roleForPin(newPin);
                if (clash && clash.key !== ukey) return sendJson(res, 400, { error: 'Ei PIN onno karo ache, alada PIN din' });
                const old = (await usersRef.child(ukey).once('value')).val();
                const hashed = await hashPin(newPin);
                await usersRef.child(ukey).set({
                    name: username, role: role === 'admin' ? 'admin' : 'user', ...hashed,
                    blocked: old ? !!old.blocked : false,
                    updatedAt: admin.database.ServerValue.TIMESTAMP
                });
                if (!old) await bref.remove();
                else revoke();
                logActivity('admin', 'user_add', username, (role === 'admin' ? 'admin' : 'user') + (old ? ' (PIN/role update)' : ' (new)'), byName);
                return sendJson(res, 200, { ok: true });
            }
            if (action === 'block' || action === 'unblock') {
                const rec = (await usersRef.child(ukey).once('value')).val();
                if (!rec) return sendJson(res, 404, { error: 'User paoa jay nai' });
                const b = action === 'block';
                await usersRef.child(ukey).update({ blocked: b });
                if (b) { await bref.set(true); revoke(); } else await bref.remove();
                logActivity('admin', b ? 'user_block' : 'user_unblock', rec.name || username, '', byName);
                return sendJson(res, 200, { ok: true });
            }
            if (action === 'delete') {
                const rec = (await usersRef.child(ukey).once('value')).val();
                if (!rec) return sendJson(res, 404, { error: 'User paoa jay nai' });
                await usersRef.child(ukey).remove();
                await bref.set(true); revoke();
                logActivity('admin', 'user_delete', rec.name || username, rec.role || '', byName);
                return sendJson(res, 200, { ok: true });
            }
            return sendJson(res, 400, { error: 'bad request' });
        }

        if (req.method === 'POST' && u.pathname === '/admin/push') {
            const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
            let dec = null;
            try { dec = m ? await admin.auth().verifyIdToken(m[1]) : null; } catch (_) {}
            if (!dec || dec.role !== 'admin') return sendJson(res, 401, { error: 'unauthorized' });
            if (bkBusy) return sendJson(res, 409, { error: 'Backup cholche, kichukkhon por try korun' });
            bkBusy = true;
            try {
                const st = await sendBackup('push');
                logActivity('admin', 'push', '', st, dec.name);
            } catch (e) { return sendJson(res, 500, { error: e.message }); }
            finally { bkBusy = false; }
            return sendJson(res, 200, { ok: true });
        }

        if (req.method === 'POST' && (u.pathname === '/admin/backup-config' || u.pathname === '/admin/backup-now')) {
            if (!(await adminReq(req))) return sendJson(res, 401, { error: 'unauthorized' });
            if (u.pathname === '/admin/backup-now') {
                if (bkBusy) return sendJson(res, 409, { error: 'Backup cholche, kichukkhon por try korun' });
                bkBusy = true;
                try {
                    const st = await sendBackup('manual');
                    logActivity('admin', 'backup_now', '', st);
                    return sendJson(res, 200, { ok: true, status: st });
                } catch (e) { return sendJson(res, 500, { error: e.message }); }
                finally { bkBusy = false; }
            }
            let body = {};
            try { body = JSON.parse((await readBody(req, 1000)).toString() || '{}'); } catch (_) {}
            const ref = db.ref('app_config/backup');
            let cfg = (await ref.once('value')).val() || {};
            if (['off', 'daily', 'weekly'].includes(body.freq)) {
                const upd = { freq: body.freq };
                if (body.freq !== 'off' && !cfg.lastBackupAt) upd.lastBackupAt = Date.now();   
                await ref.update(upd);
                cfg = { ...cfg, ...upd };
                logActivity('admin', 'backup_config', body.freq, '');
            }
            return sendJson(res, 200, { freq: cfg.freq || 'off', lastBackupAt: cfg.lastBackupAt || 0, lastStatus: cfg.lastStatus || '' });
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Phoenix Dual-DB Bot is Running Perfectly');
    } catch (e) {
        console.error('HTTP error:', e.message);
        if (!res.headersSent) sendJson(res, 500, { error: 'server error' }); else res.end();
    }
});

const DHAKA_MS = 6 * 3600 * 1000;   
const dhakaDate = () => new Date(Date.now() + DHAKA_MS).toISOString().slice(0, 10);
const dhakaWhen = (ts) => new Date((ts || Date.now()) + DHAKA_MS).toISOString().replace('T', ' ').slice(5, 16);   

async function adminReq(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    try { const d = m ? await admin.auth().verifyIdToken(m[1]) : null; return d && d.role === 'admin' ? d : null; } catch (_) { return null; }
}
const tgSend = (html) => bot.telegram.sendMessage(TG_CHAT_ID, html, { parse_mode: 'HTML', disable_web_page_preview: true });

const NOTE_LABEL = { add: 'New site', edit: 'Edit', merge: 'Merge', delete: 'Delete', import_master: 'Import data', import_keys: 'Import keys', wipe_master: 'WIPE data', wipe_keys: 'WIPE keys', pin_change: 'PIN changed', user_add: 'User Added', user_delete: 'User Deleted' };
const NOTE_ICON = { add: '➕', edit: '✏️', merge: '🔀', delete: '🗑', import_master: '📥', import_keys: '📥', wipe_master: '⚠️', wipe_keys: '⚠️', pin_change: '🔐', user_add: '👤', user_delete: '👤' };
Object.assign(NOTE_LABEL, { user_block: 'User BLOCK', user_unblock: 'User unblock' });
Object.assign(NOTE_ICON, { user_block: '⛔', user_unblock: '✅' });
const BOOT_MS = Date.now();
const seenLog = new Set();
let noteQ = [], noteTimer = null;

function noteText(l) {
    const who = l.name ? `${l.name} (${l.role})` : l.role;
    const out = [`${NOTE_ICON[l.action] || '🔔'} <b>${esc(NOTE_LABEL[l.action] || l.action)}</b>`, `👤 <b>${esc(who)}</b>`];
    if (l.site) out.push(`📌 ${esc(l.site)}`);
    if (l.detail) out.push(`📝 ${esc(l.detail)}`);
    out.push(`🕒 ${dhakaWhen(l.ts)} (Dhaka)`);
    return out.join('\n');
}
function noteSummary(q) {
    const by = {};
    q.forEach(l => { const k = (NOTE_LABEL[l.action] || l.action) + ' (' + (l.name || l.role) + ')'; by[k] = (by[k] || 0) + 1; });
    const sites = [...new Set(q.map(l => l.site).filter(Boolean))];
    return `📦 <b>${q.length} ta change</b>\n` +
        Object.entries(by).map(([k, n]) => `• ${esc(k)}: ${n}`).join('\n') +
        (sites.length ? `\n📌 ${sites.slice(0, 8).map(esc).join(', ')}${sites.length > 8 ? ` +${sites.length - 8} more` : ''}` : '') +
        `\n🕒 ${dhakaWhen()} (Dhaka)`;
}
async function flushNotes() {
    noteTimer = null;
    const q = noteQ; noteQ = [];
    if (!q.length) return;
    try {
        if (q.length <= 3) { for (const l of q) await tgSend(noteText(l)); }
        else await tgSend(noteSummary(q));   
    } catch (e) { console.error('Notify error:', e.message); }
}
db.ref('activity_log').orderByKey().limitToLast(200).on('child_added', (snap) => {
    const l = snap.val() || {};
    if (seenLog.has(snap.key)) return;
    seenLog.add(snap.key); if (seenLog.size > 2000) seenLog.clear();
    if (!NOTE_LABEL[l.action]) return;
    if (l.action === 'edit' && l.detail === 'no change') return;
    if (!l.ts || l.ts < BOOT_MS - 2000) return;   
    noteQ.push(l);
    if (!noteTimer) noteTimer = setTimeout(flushNotes, 8000);
}, (err) => console.error('Notify listener error:', err.message));

let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) { console.error('⚠️ xlsx package install kora nai, auto backup bondho thakbe (npm install xlsx)'); }

function lastSlot(freq, nowMs) {   
    const d = new Date(nowMs + DHAKA_MS);
    let slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2);
    if (slot > nowMs + DHAKA_MS) slot -= 86400000;
    if (freq === 'weekly') slot -= new Date(slot).getUTCDay() * 86400000;
    return slot - DHAKA_MS;
}
async function makeBackup() {
    const [ms, ks] = await Promise.all([db.ref('professor_master_db').once('value'), db.ref('professor_keys_db').once('value')]);
    const rows = toArray(ms.val()).map(r => { const a = normRow(r); return a ? Array.from(a, c => (c === undefined || c === null ? '' : c)) : []; });
    const keys = ks.val() || {};
    const keyRows = [['Site Name', 'Key Info'], ...Object.keys(keys).map(k => [k, valueToString(keys[k]).slice(0, 32000)])];
    const mk = (aoa, name) => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    };
    return { master: mk(rows, 'MasterData'), keys: mk(keyRows, 'KeysData'), sites: Math.max(rows.length - 1, 0), nkeys: keyRows.length - 1 };
}
async function sendBackup(kind) {
    if (!XLSX) throw new Error('Server e xlsx package nai (npm install xlsx)');
    const b = await makeBackup(), d = dhakaDate();
    const cap = `💾 PHOENIX ${kind === 'auto' ? 'AUTO' : kind === 'push' ? 'PUSH' : 'MANUAL'} BACKUP\n📅 ${d}\n🌐 Sites: ${b.sites} · 🔑 Keys: ${b.nkeys}`;
    await bot.telegram.sendDocument(TG_CHAT_ID, { source: b.master, filename: `Phoenix_Master_${d}.xlsx` }, { caption: cap });
    await bot.telegram.sendDocument(TG_CHAT_ID, { source: b.keys, filename: `Phoenix_Keys_${d}.xlsx` });
    return `ok (${b.sites} sites, ${b.nkeys} keys)`;
}
let bkBusy = false, bkLastTry = 0;
async function backupTick() {
    if (bkBusy || !XLSX) return;
    try {
        const ref = db.ref('app_config/backup');
        const cfg = (await ref.once('value')).val() || {};
        if (cfg.freq !== 'daily' && cfg.freq !== 'weekly') return;
        if ((cfg.lastBackupAt || 0) >= lastSlot(cfg.freq, Date.now())) return;   
        if (Date.now() - bkLastTry < 30 * 60 * 1000) return;                     
        bkBusy = true; bkLastTry = Date.now();
        try {
            const st = await sendBackup('auto');
            await ref.update({ lastBackupAt: Date.now(), lastStatus: st });
            logActivity('system', 'backup', '', st);
        } catch (e) {
            console.error('Backup error:', e.message);
            await ref.update({ lastStatus: 'failed: ' + String(e.message).slice(0, 100) }).catch(() => {});
        }
    } catch (e) { console.error('Backup tick error:', e.message); }
    finally { bkBusy = false; }
}
setInterval(backupTick, 60000);
setTimeout(backupTick, 20000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`📡 Server listening on port ${PORT}`));

const PING_URL = process.env.PING_URL || process.env.RENDER_EXTERNAL_URL || "https://link-edge-50mt.onrender.com";
setInterval(() => {
    https.get(PING_URL, (res) => {
        res.resume(); 
        console.log("⚡ Keep-Alive: Pinged at " + new Date().toLocaleTimeString());
    }).on('error', (err) => {
        console.error("Ping Error: " + err.message);
    });
}, 180000);

async function startBot() {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("🚀 Phoenix Telegram Vault & Dual-DB Handler is Online!");
    } catch (e) {
        console.error("❌ Bot Launch Error:", e.message);
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));