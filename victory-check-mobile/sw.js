const CACHE = 'visural-check-v40';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/theme.js',
  './js/data.js',
  './js/email-preview.js',
  './js/version.js',
  './js/api.js',
  './js/login.js',
  './js/push-notify.js',
  './js/onboarding.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => res)
      .catch(() => caches.match(e.request))
  );
});
