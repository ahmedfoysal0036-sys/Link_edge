const V = 'phoenix-v6';
const SHELL = ['./', './index.html', './manifest.json', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './bts-logo.jpg'];
const CDN = [
  'https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.0.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.0.0/firebase-database-compat.js',
  'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];
const CDN_HOSTS = ['www.gstatic.com', 'cdn.sheetjs.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then(async (c) => {
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Firebase / Render API / Telegram request kokhono cache hoy na (shudhu nijer file + CDN script)
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then((res) => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); }
      return res;
    }).catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('./index.html') : null) || Response.error())));
  } else if (CDN_HOSTS.includes(u.hostname)) {
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => {
      const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); return res;
    })));
  }
});