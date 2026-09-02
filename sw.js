// sw.js — Service Worker del cuadrante (solo GitHub Pages).
//
// Sin esto, la pagina necesita red cada vez que se abre: en un hospital la
// cobertura no siempre esta. Con este fichero, la primera visita cachea el
// armazon (pagina, manifest, iconos) y las siguientes funcionan sin red.
//
// La pagina se sirve con "red primero": asi las actualizaciones del
// index.html llegan siempre que haya conexion, y la cache solo actua de
// respaldo cuando no la hay. Los iconos y el manifest van "cache primero",
// porque no cambian casi nunca.
const CACHE = "cuadrante-v1";
const RECURSOS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(RECURSOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegacion: red primero, cache como respaldo sin conexion.
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copia));
          return resp;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("./index.html"))
        )
    );
    return;
  }

  // El resto (iconos, manifest): cache primero, rellenando lo que falte.
  ev.respondWith(
    caches.match(req).then((enCache) =>
      enCache || fetch(req).then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return resp;
      })
    )
  );
});
