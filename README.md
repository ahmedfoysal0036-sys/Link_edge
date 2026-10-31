# Phoenix Controller

BTS site data manager. Site, IP, client, location ar key info ek jaygay rakha, web app (iPhone/PC) ar Telegram bot dui vabei search kora jay.

- **Web app:** `index.html` (V4.5), GitHub Pages e chole. Single file, vanilla JS, PWA (iPhone Safari).
- **Server + Bot:** `index.js` (bot `v4.1-merge-keyonly`), Render e chole. Telegraf bot + HTTP API.
- **Database:** Firebase Realtime Database (project `phoenixdatabase-v1`).

## Repo file list

| File | Kaj |
|---|---|
| `index.html` | Puro frontend (UI, login, import, search, dashboard, theme) |
| `index.js` | Server: PIN login, user manage, Telegram bot, backup, push |
| `sw.js` | Service Worker (offline shell, cache name `phoenix-v2`) |
| `manifest.json` | PWA setting |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `bts-logo.jpg` | Icon ar logo |
| `package.json`, `package-lock.json` | Node dependency (`firebase-admin`, `telegraf`, `xlsx`) |
| `firebase.json`, `_firebaserc` | Firebase setting (live site root `index.html` theke chole, `public/` folder use hoy na) |
| `_gitignore` | GitHub e na jawa file list (`.env`, `node_modules` etc.) |

## Render Environment variables

Render > service > **Environment** e boshan. Kono secret GitHub e dite hobe na.

| Key | Dorkar | Kaj |
|---|---|---|
| `BOT_TOKEN` | Hae | Telegram bot token |
| `FIREBASE_CONFIG` | Hae | Firebase service account (JSON) |
| `MASTER_PIN` | Hae | Admin master PIN. Na thakle server start hoy na |
| `TG_CHAT_ID` | Optional | Backup/push jabe ei chat e |
| `ALLOWED_ORIGIN` | Optional | Kon site theke API call allowed |
| `PING_URL` | Optional | Keep-alive ping URL |

Master PIN bodlate: Render e `MASTER_PIN` bodlan, auto redeploy hobe. Purono PIN GitHub history te thakle notun PIN dewai nirapod.

## Roles

- **Admin:** Master PIN diye login. Shob kaj: import, backup, wipe, user manage, log.
- **User:** Admin er banano PIN. Search, view, add/edit korte pare. Data Tools, wipe, log dekhte pare na.
- Admin user list theke Block/Unblock/Delete korte pare. Block korle login bondho, cholti session o kete jay.
- Same PIN duijon ke ba Master PIN er soman dewa jay na.

## Shuvidha (feature) list

### Search ar site
- Site code, IP, node diye search. ID diye match (jemon `GZP_B1234`).
- Client / Sub-Center / Model dropdown filter, recent search, map (Leaflet).
- View modal e **Copy Data**: Site, IP, Client, Sub-Center, Node, Model, Location link ar pura Key info ek text e.
- Duplicate site add korle **Merge / Update existing / Cancel**.

### Import (Smart Merge)
`Data Tools` > Import:
- **Import Data:** site naam ba ID dhore merge. Notun site add, mil thakle update (file er khali cell diye purono data muche na), file e na thaka site thake. Age preview dekhay.
- **Import Key:** purono key er sathe notun entry jug hoy, duplicate bad jay, `&amp;` theek hoye jay.
- **Replace all:** puro replace, Admin PIN lage.
- Merge ba Replace er age Telegram e auto-backup jay. Backup fail korle jiggesh kore.

### Key-only site
Key ache kintu BTS data te site nai, emon site "BTS data nai" badge soho list ar search e (bot e o) ashe. Pore BTS data te oi site ashle ID mile nije theke jure jay. Filter bar e "Key-only (N)" button ache.

### Dashboard
- Total site, total key, last sync.
- Key nei, Location nei, Key-only (click korle key-only list).
- Client breakdown (data theke auto).
- Admin only: **Recent login**, **Last key update**.

### Theme
5 ta: Dark, Light, Neon, Ocean, Sunset. Settings e bachai, browser e save thake, change e halka fade.

### Backup ar Telegram
- Auto backup: Settings e Off / Daily / Weekly, Dhaka somoy raat 2 tay Master + Keys Excel Telegram e.
- **Backup now** ar **Push to Telegram**: dui file-i (Master + Keys) pathay.
- **Backup Data / Backup Key:** Excel download (PIN lage).

### Activity log
Proti kaj (login, add, edit, import, wipe, block etc.) log hoy, user er naam soho. Edit e `IP: 10.1.1.1 → 10.1.1.9` dhoner age → pore dekhay. Settings > Activity log (Admin).

### Offline
Ager bar online login kora thakle, offline e last save kora data view-only dekha jay.

## Bot use

Telegram bot e site code likhe pathan (jemon `GZP_B1234`). Result e site info ar key info ashe.

- `KEY GZP_B1234` ba `GZP_B1234 KEY` likhle shudhu key info.
- `/version` e bot version, site ar key sonkha, key-only sonkha.
- Key-only site o search e ashe, "BTS data nai" likha soho.

## Deploy

1. `index.html` / `index.js` bodlale GitHub e push (dutoi root folder e).
2. `index.js` bodlale Render nije redeploy kore. `/version` pathiye version milan.
3. `index.html` bodlale 1-2 min por `Ctrl+Shift+R`. iPhone PWA hole app bondho kore abar khulun.
4. Firebase Rules bodlale Firebase Console > Realtime Database > Rules e **Publish**.

Settings er niche "PHOENIX V4.5" dekhe version milan.

## Database paths

| Path | Ki thake |
|---|---|
| `professor_master_db` | Site list (array, prothom row header: Site, IP, Sub-Center, Node, Model, Lat, Long, Client) |
| `professor_keys_db` | Key info (site naam -> text) |
| `activity_log` | Activity history |
| `app_config` | Users, blocked list, backup setting |

Ei structure bodlano jabe na.

## Shabdhan

- `MASTER_PIN`, `BOT_TOKEN`, service account key kokhono GitHub e dibe na.
- `.env` file banano lagbe na, Render Environment e shob set kora ache.
- Service account JSON (`firebase-adminsdk*.json`) repo te thakle muche din ar purono key revoke korun.

## Version history

| Version | Ki hoyeche |
|---|---|
| V4.0 | Roles, Change PIN, auto logout, activity log, duplicate merge, filters, map, recent search, auto backup, PWA |
| V4.3 | User list + Block/Delete, name soho log, Copy Data, Push e Key file, `&amp;` fix |
| V4.4 | Smart Merge import (Data + Key), key-only site |
| V4.5 | Dashboard (health, recent login, last key update), 5 theme + fade |
