/* Manhwa Library — Service Worker (offline shell) */
const CACHE = 'manhwa-v2';  // bumped: ships the share system
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.png',
  './icons/placeholder.svg'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(ASSETS.map(u=> new Request(u,{cache:'reload'})))).then(()=> self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=> caches.delete(k)))).then(()=> self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;
  // network-first for our html (so updates show), cache-first for static
  if(e.request.mode === 'navigate'){
    e.respondWith(fetch(e.request).catch(()=> caches.match('./index.html')));
    return;
  }
  if(url.origin === location.origin){
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp=>{
        const copy = resp.clone();
        caches.open(CACHE).then(c=> c.put(e.request, copy));
        return resp;
      }).catch(()=> r))
    );
  }
});
