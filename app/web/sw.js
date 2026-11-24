/* Service worker : met l'application en cache pour qu'elle fonctionne sans connexion.
   La version (remplacée à la construction du site) change le nom du cache à chaque publication. */
const VERSION = "__VERSION__";
const CACHE = "visites-plongeurs-" + VERSION;
const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "icone.svg", "manifest.webmanifest",
  "defaut_config.json", "version.json", "lib/jszip.min.js",
  "moteur/balises.js", "moteur/dates.js", "moteur/docx.js", "moteur/generation.js",
  "moteur/local.js", "moteur/regles.js", "moteur/stockage.js",
  "icones/icone-180.png", "icones/icone-192.png", "icones/icone-512.png", "icones/icone-masquable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k.startsWith("visites-plongeurs-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then((rep) => {
    if (rep.ok) { const c = rep.clone(); caches.open(CACHE).then((cache) => cache.put(r, c)); }
    return rep;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match("index.html"))));
});
