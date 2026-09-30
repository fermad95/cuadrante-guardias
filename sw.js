// sw.js — Service Worker del cuadrante (solo GitHub Pages).
//
// Sin esto, la pagina necesita red cada vez que se abre: en un hospital la
// cobertura no siempre esta. Con este fichero, la primera visita cachea el
// armazon (pagina, manifest, iconos) y las siguientes funcionan sin red.
//
// La pagina se sirve con "red primero": asi las actualizaciones del
// index.html llegan siempre que haya conexion, y la cache solo actua de
// respaldo cuando no la hay. Pero "haber conexion" en un hospital a veces es
// una raya de cobertura que no llega a traer nada: si la red no contesta en
// PLAZO_MS se abre la copia guardada, y la respuesta de la red, cuando
// llegue, actualiza la copia para la proxima vez. Los iconos y el manifest
// van "cache primero", porque no cambian casi nunca.
const PLAZO_MS = 3000;
const CACHE = "cuadrante-guardias-v1";
const PREFIJO = CACHE.replace(/\d+$/, "");
const RECURSOS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// Librerias que la app carga de fuera: Firebase (sesion y copia en la nube) y
// pdf.js (leer las nominas). Llevan la version en la direccion, asi que su
// contenido no cambia nunca y se pueden guardar para siempre. Hace falta
// guardarlas: si la app se abre sin cobertura y Firebase no carga, Chrome
// recuerda ese fallo hasta recargar la pagina (no sirve reintentar), y la app
// se quedaba sin sincronizar aunque volviera la conexion. Con la copia
// guardada, Firebase carga siempre y la sincronizacion se reanuda sola.
// La version tiene que ser la misma que en src/nube.js y src/nomina-pdf.js
// (lo vigila test/build.test.js).
const FIREBASE = "https://www.gstatic.com/firebasejs/10.13.2/";
const EXTERNAS = [FIREBASE, "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/"];
const SDK = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map((f) => FIREBASE + f);

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // El SDK se intenta guardar ya, pero si falla no impide instalar: se
      // guardara la primera vez que la app lo pida.
      .then((c) => c.addAll(RECURSOS).then(() => c.addAll(SDK).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        // Solo las versiones viejas de ESTA app: las dos copias del cuadrante
        // comparten origen (y por tanto caches), y borrar todo lo ajeno dejaba a
        // la otra sin su copia para abrir sin conexion.
        claves.filter((k) => k !== CACHE && k.startsWith(PREFIJO)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function pagina(ev, req) {
  const guardada = () => caches.match(req).then((r) => r || caches.match("./index.html"));
  // Solo se guarda una respuesta buena: una pagina de error del servidor no
  // debe sustituir a la copia que funciona.
  const deRed = fetch(req).then((resp) => {
    if (resp.ok) {
      const copia = resp.clone();
      ev.waitUntil(caches.open(CACHE).then((c) => c.put("./index.html", copia)));
    }
    return resp;
  });
  ev.waitUntil(deRed.catch(() => {}));
  const plazo = new Promise((resolver) => { setTimeout(resolver, PLAZO_MS, null); });
  try {
    const primera = await Promise.race([deRed, plazo]);
    if (primera && primera.ok) return primera;
    return (await guardada()) || primera || (await deRed);
  } catch {
    return (await guardada()) || Response.error();
  }
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (EXTERNAS.some((prefijo) => req.url.startsWith(prefijo))) {
    ev.respondWith(
      caches.match(req).then((enCache) =>
        enCache || fetch(req).then((resp) => {
          if (!resp.ok) return resp;
          const copia = resp.clone();
          ev.waitUntil(caches.open(CACHE).then((c) => c.put(req, copia)));
          return resp;
        })
      )
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Navegacion: red primero, cache como respaldo sin conexion.
  if (req.mode === "navigate") {
    ev.respondWith(pagina(ev, req));
    return;
  }

  // El resto (iconos, manifest): cache primero, rellenando lo que falte.
  ev.respondWith(
    caches.match(req).then((enCache) =>
      enCache || fetch(req).then((resp) => {
        if (!resp.ok) return resp;
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return resp;
      })
    )
  );
});
