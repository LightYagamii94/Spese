'use strict';

// Service worker: rende l'app installabile e utilizzabile anche senza connessione.
// Mette in cache solo i file dell'app (pagina, stile, codice, icone): i dati
// delle spese restano nel browser e non passano mai da qui.
//
// Strategia "prima la rete": quando c'è connessione si scarica sempre la
// versione più recente (così gli aggiornamenti arrivano subito); se manca la
// rete si usa la copia salvata.

const CACHE = 'spese-app-v2';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Il controllo degli aggiornamenti va sempre in rete e non si salva in cache.
  if (url.pathname.endsWith('/version.json')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Si usa l'indirizzo e non la richiesta originale: quelle di navigazione
      // non si possono ripetere con opzioni diverse.
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./') : undefined);
      return hit || Response.error();
    }
  })());
});
