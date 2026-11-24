/* Manhwa Library — Service Worker (offline shell)
   Strategy: NETWORK-FIRST for the app's own files (so a new deploy shows up right away),
   falling back to the cache only when offline. Bump CACHE when you want old caches purged. */
const CACHE = 'manhwa-v3';
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
  e.waitUntil(
    caches.open(CACHE)
      .then(c=> c.addAll(ASSETS.map(u=> new Request(u,{cache:'reload'}))))
      .then(()=> self.skipWaiting())
  );
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;          // fonts etc. -> default browser handling

  e.respondWith((async ()=>{
    try{
      // 'no-cache' = always revalidate with the server, ignoring GitHub Pages' 10-minute max-age
      const resp = await fetch(req, {cache:'no-cache'});
      if(resp && resp.ok && resp.type === 'basic'){
        const copy = resp.clone();
        const key = req.mode === 'navigate' ? './index.html' : req;
        caches.open(CACHE).then(c=> c.put(key, copy)).catch(()=>{});
      }
      return resp;
    }catch(_){
      // offline
      const hit = await caches.match(req, {ignoreSearch:true});
      if(hit) return hit;
      if(req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
