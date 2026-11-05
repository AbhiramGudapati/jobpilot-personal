const CACHE = 'jobpilot-shell-v14';
const SHELL = ['./', './index.html', './style.css', './app.js', './push-client.js', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('jobpilot-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/feed.json')) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && url.pathname.match(/\.(html|css|js|svg|png|webmanifest)$/) || response.ok && event.request.mode === 'navigate') {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

// True background push, delivered by the push service even when all tabs are closed.
self.addEventListener('push', event => {
  let incoming = {};
  try { incoming = event.data?.json() || {}; } catch { incoming = {}; }
  const title = String(incoming.title || 'JobPilot reminder').slice(0, 90);
  const body = String(incoming.body || 'An upcoming schedule needs your attention.').slice(0, 200);
  const tag = String(incoming.tag || 'jobpilot-reminder').slice(0, 180);
  event.waitUntil(self.registration.showNotification(title, {
    body, tag, icon:'./apple-touch-icon.png', badge:'./icon.svg',
    data:{url:'./?open=calendar'}, renotify:true
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('./?open=calendar', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    for(const client of clients) {
      if(client.url.startsWith(self.registration.scope) && 'focus' in client) {await client.navigate(url);return client.focus();}
    }
    return self.clients.openWindow(url);
  }));
});