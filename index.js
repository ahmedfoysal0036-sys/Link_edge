const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const http = require('http');
const https = require('https');
const fs = require('fs');

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
const BOT_VERSION = 'v3.7-token-fix';
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

const toArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

const str = (v) => (v === undefined || v === null ? '' : v.toString().trim());

const valueToString = (val) => {
    if (val && typeof val === 'object') val = Object.values(val).join(' | ');
    return val ? val.toString().trim() : '';
};

// Firebase kokhono kokhono sparse row ke array er bodole object banay -> array e ferot
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

// ---- ID matching: DHK2952 == DHK_Y2952 == X2952 (region + number, type letter optional) ----
const R_TYPED  = /(^|[^A-Z0-9])([A-Z]{2,6})[_ -]([A-Z])(\d{2,5})(?!\d)/g;   // DHK_Y2952
const R_REGION = /(^|[^A-Z0-9])([A-Z]{2,6})(\d{2,5})(?!\d)/g;                // DHK2952, DHLLB13
const R_BARE   = /(^|[^A-Z0-9])([A-Z])(\d{3,5})(?!\d)/g;                     // X2952
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
const typOk = (a, b) => !a || !b || a === b;   // type letter dutoi thakle same hote hobe (X != Y)
const addTo = (m, k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };

// Key DB -> 3 ta index: full text, region+number, number-only (>=4 digit)
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

// 1) precise: same region + number (type letter ignore) ba pura naam same
// 2) na pele: master e region nai (X2952) -> number mile gele "≈" chinho diye dekhai
function lookupKeys(siteName, idx) {
    const precise = new Set(), weak = new Map();
    (idx.full.get(safeKey(siteName)) || []).forEach(e => precise.add(e.v));
    // letters-only code (DHJKTL): SGDHHBG003_DHJKTL / DHHAZ039HTR01_DHJKTL -> token DHJKTL ke key naam er sathe exact milai
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

// Search hobe shudhu ei column gulo te. Lat/Long (5,6) bad, na hole "8831" lat-long er digit e mile jay.
const SEARCH_COLS = [0, 1, 2, 3, 4, 7];

function buildMasterIndex(masterVal) {
    const out = [];
    for (const raw of toArray(masterVal).slice(1)) {
        const row = normRow(raw);
        if (!row) continue;
        const name = str(row[0]);
        const ids = parseIds(name);
        // alias: DHK_Y2952 ke DHK2952 / 2952 likhlew khuje paoa jabe
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

// Multi-word AND search + ranking (exact > starts-with > name-contains > onno column)
function searchRows(index, query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const q = tokens.join(' ');
    const qid = tokens.length === 1 ? parseIds(q) : [];
    const qi = qid.length === 1 && qid[0].num.length >= 4 ? qid[0] : null;
    const hits = [];
    for (const e of index) {
        const textHit = tokens.every(t => e.hay.includes(t));
        // DHK2952 likhle region-hin master naam (X2952) o ashbe
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

// ---------- In-memory cache (Firebase realtime sync) ----------
// Ager version prottek message e duita pura DB download korto -> eta e lag er main karon.
const state = {
    index: [],
    keyIdx: buildKeyIndex({}),
    keyCount: 0,
    masterReady: false,
    keysReady: false
};

db.ref('professor_master_db').on('value', (snap) => {
    try {
        state.index = buildMasterIndex(snap.val());
        state.masterReady = true;
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
        // HTML fail korle plain text e pathai, jate user kichu na pay emon na hoy
        const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        await ctx.reply(plain.slice(0, 4000), { disable_web_page_preview: true }).catch(() => {});
    }
}

bot.command('version', async (ctx) => {
    await ctx.reply(
        `🤖 Bot version: ${BOT_VERSION}\n` +
        `📋 Sites in cache: ${state.index.length}\n` +
        `🔑 Total keys in DB: ${state.keyCount}\n` +
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
    if (state.index.length === 0) {
        return ctx.reply('❌ Master Database is empty.');
    }

    try {
        const results = searchRows(state.index, query);

        if (results.length === 0) {
            return sendHtml(ctx, `❌ No match found for: <b>${esc(query)}</b>`);
        }

        const shownList = results.slice(0, MAX_RESULTS);
        const header = `✅ <b>Found ${results.length} results</b>` +
            (results.length > MAX_RESULTS ? ` (showing top ${MAX_RESULTS})` : '') + `\n\n`;

        const blocks = shownList.map(({ row: r, name }) => {
            const ip = str(r[1]) || '-';
            const subCenter = str(r[2]) || '-';
            const nodeAddr = str(r[3]) || '-';
            const model = str(r[4]) || '-';
            const lat = str(r[5]) || '0';
            const long = str(r[6]) || '0';
            const client = str(r[7]) || '-';

            const mapLink = (lat !== '0' && long !== '0')
                ? `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(long)}` : null;

            let keyInfo = lookupKeys(name, state.keyIdx) || 'No key info available';
            if (keyInfo.length > 900) keyInfo = keyInfo.slice(0, 900) + ' ...';

            let b = '';
            if (isKeyOnly) {
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

        // Telegram limit er moddhe thaka block gulo ei rakhi (tag er majhkhane kata hobe na)
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

// ---------- Keep-alive server ----------
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Phoenix Dual-DB Bot is Running Perfectly');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`📡 Server listening on port ${PORT}`));

const PING_URL = process.env.PING_URL || process.env.RENDER_EXTERNAL_URL || "https://link-edge.onrender.com";
setInterval(() => {
    https.get(PING_URL, (res) => {
        res.resume(); // response consume na korle socket jome thake
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
