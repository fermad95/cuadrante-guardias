// src/nube.js
//
// Sincronizacion con Firebase (Auth con Google + Firestore), para cuando la
// app vive fuera de un Artifact de Claude (GitHub Pages). Reglas de
// Firestore: cada usuario solo puede leer/escribir /usuarios/{su-propio-uid}.
//
// El SDK de Firebase se carga con `import()` dinamico, no con un `import`
// estatico: un `import` estatico que falla (sin red) tira abajo TODO el
// modulo del script y la app entera dejaria de arrancar. Con import()
// dinamico, si falla (sin red, CDN caida), el resto de la app sigue
// funcionando con localStorage, igual que sin esta capacidad.
const CDN = "https://www.gstatic.com/firebasejs/10.13.2";

const CONFIG = {
  apiKey: "AIzaSyDo9DJWIM6tbCOH1tXgFuG4qa3R9BI260k",
  authDomain: "cuadrante-755f5.firebaseapp.com",
  projectId: "cuadrante-755f5",
  storageBucket: "cuadrante-755f5.firebasestorage.app",
  messagingSenderId: "887931018938",
  appId: "1:887931018938:web:72e32b54f36d89e2f9ec83",
  measurementId: "G-DR0V21E4M8",
};

let sdkPromesa = null;

function cargarSDK() {
  if (!sdkPromesa) {
    sdkPromesa = Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]).then(([appMod, authMod, fsMod]) => {
      const app = appMod.initializeApp(CONFIG);
      return { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), authMod, fsMod };
    }).catch(() => null);
  }
  return sdkPromesa;
}

// Llama a `fn(usuario | null)` cada vez que cambia la sesion. `usuario` es
// `{ uid, nombre, correo, foto }` o `null` si no hay sesion. Si el SDK no
// carga (sin red), se llama una vez con null y ya esta.
export function alCambiarSesion(fn, alErrorRedireccion) {
  cargarSDK().then((f) => {
    if (!f) { fn(null); return; }
    f.authMod.onAuthStateChanged(f.auth, (u) => {
      fn(u ? { uid: u.uid, nombre: u.displayName, correo: u.email, foto: u.photoURL } : null);
    });
    // Si venimos de un login por redireccion (sin popup), la sesion se restaura
    // igual por onAuthStateChanged, pero getRedirectResult cierra el flujo y
    // puede rechazar con el motivo real (dominio no autorizado, almacenamiento
    // bloqueado por Safari, etc.): se reporta en vez de descartarse en
    // silencio, para poder diagnosticar el login atascado en el movil.
    f.authMod.getRedirectResult(f.auth).catch((err) => {
      if (typeof alErrorRedireccion === "function") alErrorRedireccion(err);
    });
  });
}

// El login va siempre por popup, tambien con la app anadida a la pantalla de
// inicio. La redireccion depende de que Firebase recupere el resultado a la
// vuelta a traves de almacenamiento de terceros (authDomain, firebaseapp.com,
// no es el dominio de la app), y Safari lo bloquea por ITP: getRedirectResult
// no rechaza, simplemente se vuelve sin sesion y sin error. Verificado en
// vivo en iPhone el 31/08/2026 en una pestana de Safari y el 30/09/2026 desde
// el icono de la pantalla de inicio (se elige la cuenta, se cierra la ventana
// de Google y la app sigue sin sesion). La redireccion queda solo como ultimo
// recurso, para cuando el navegador no deja abrir el popup.
const SIN_POPUP = ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"];

// `authMod` es el modulo de Auth del SDK; va como parametro para poder
// probar la eleccion popup/redireccion sin navegador.
export async function entrarConGoogle(authMod, auth) {
  const proveedor = new authMod.GoogleAuthProvider();
  try {
    await authMod.signInWithPopup(auth, proveedor);
  } catch (err) {
    if (!err || !SIN_POPUP.includes(err.code)) throw err;
    await authMod.signInWithRedirect(auth, proveedor); // recarga la pagina
  }
}

export async function iniciarSesion() {
  const f = await cargarSDK();
  if (!f) throw new Error("Sin conexion: no se puede iniciar sesion ahora mismo.");
  await entrarConGoogle(f.authMod, f.auth);
}

export async function cerrarSesion() {
  const f = await cargarSDK();
  if (!f) return;
  await f.authMod.signOut(f.auth);
}

async function uidActual() {
  const f = await cargarSDK();
  return f && f.auth.currentUser ? { f, uid: f.auth.currentUser.uid } : null;
}

// Nombrada distinto de la del Artifact (`cargarRemoto` en persistencia.js):
// build.mjs concatena todos los modulos en un unico script, y un alias en el
// `import` de ui.js no evita el choque de nombres a nivel superior — hacen
// falta nombres de verdad distintos en el propio archivo.
export async function cargarNube() {
  const r = await leerNube();
  return r.ok ? r.dato : null;
}

// Como cargarNube, pero distingue "esta cuenta no tiene datos" ({ ok: true,
// dato: null }) de "no se ha podido leer" ({ ok: false }): al cambiar de
// cuenta no es lo mismo empezar en blanco que no saber que hay. Devuelve
// tambien el uid leido, por si la sesion cambia mientras llega la respuesta.
export async function leerNube() {
  const act = await uidActual();
  if (!act) return { ok: false };
  const { f, uid } = act;
  try {
    const snap = await f.fsMod.getDoc(f.fsMod.doc(f.db, "usuarios", uid));
    return { ok: true, uid, dato: snap.exists() ? snap.data() : null };
  } catch {
    return { ok: false };
  }
}

// `esMasReciente` (la logica de "gana quien sea mas reciente") se reutiliza
// de persistencia.js: es la misma funcion pura, y por el mismo motivo de
// arriba no puede haber una segunda declaracion con el mismo nombre aqui.

// Debounced + envio inmediato al ocultar la pestana, igual que el guardado
// en el Artifact. `alCambiarEstado(estado)` recibe "comprobando" / "al-dia" /
// "pendiente" / "no-disponible" (no-disponible tambien cuando no hay sesion).
// `cuentaPermitida()` (opcional) devuelve el uid de la cuenta duena de los
// datos locales: si hay una y la sesion es otra, no se escribe nada. Evita
// que un guardado pendiente de una cuenta acabe en la nube de otra al
// cambiar de cuenta en el mismo dispositivo.
export function creaGuardadoNube(alCambiarEstado, cuentaPermitida) {
  let temporizador = null;
  let ultimoEnviado = null;
  let ultimoUid = null;
  let pendiente = null;
  let estado = "comprobando";

  function fijarEstado(nuevo) {
    if (nuevo === estado) return;
    estado = nuevo;
    if (typeof alCambiarEstado === "function") alCambiarEstado(estado);
  }

  // Si al arrancar ya hay sesion (usuario que volvio), que el aviso empiece
  // en "al dia" (nada pendiente) en vez de quedarse en "no disponible" hasta
  // el primer cambio, que seria enganoso teniendo sesion. Ojo: dos intentos
  // anteriores (mirar `currentUser` justo tras cargar el SDK, y despues
  // esperar a un solo `onAuthStateChanged`/`authStateReady()`) seguian
  // dejando el aviso encasquillado en "no disponible" — verificado en vivo
  // las dos veces: la sesion persistida puede tardar en resolverse mas de lo
  // que cualquiera de esas señales garantiza, y cualquier comprobacion de
  // "una sola vez" puede caer justo antes de que se resuelva. La solucion no
  // es afinar CUANDO se comprueba, sino no fiarse nunca de un "no hay
  // sesion" que salga de aqui: este listener se queda escuchando
  // indefinidamente (no una vez) y solo corrige el aviso hacia "al dia" en
  // cuanto aparece un usuario real, aunque sea tarde. El "no disponible" por
  // ausencia de sesion solo se declara tras un plazo de gracia sin que
  // aparezca nadie — y si la sesion llega despues de todos modos, este mismo
  // listener lo corrige.
  cargarSDK().then((f) => {
    if (!f) { if (estado === "comprobando") fijarEstado("no-disponible"); return; }
    f.authMod.onAuthStateChanged(f.auth, (u) => {
      if (u && (estado === "comprobando" || estado === "no-disponible")) fijarEstado("al-dia");
    });
    setTimeout(() => {
      if (estado === "comprobando") fijarEstado("no-disponible");
    }, 8000);
  });

  async function enviar(datoAGuardar) {
    const act = await uidActual();
    if (!act) { fijarEstado("no-disponible"); return; }
    const { f, uid } = act;
    const duena = typeof cuentaPermitida === "function" ? cuentaPermitida() : null;
    if (duena && duena !== uid) { fijarEstado("no-disponible"); return; }
    // Si ha cambiado de cuenta (cerrar sesion + entrar con otra Google
    // distinta) sin que el estado local haya cambiado, no hay que confiar
    // en el "ya esta enviado" de la cuenta anterior.
    if (uid !== ultimoUid) { ultimoEnviado = null; ultimoUid = uid; }
    const contenido = JSON.stringify(datoAGuardar);
    if (contenido === ultimoEnviado) { fijarEstado("al-dia"); return; }
    try {
      // Se envia la version ya serializada, no el objeto vivo: Firestore
      // rechaza cualquier campo `undefined` y el guardado entero fallaria.
      await f.fsMod.setDoc(f.fsMod.doc(f.db, "usuarios", uid), JSON.parse(contenido));
      ultimoEnviado = contenido;
      fijarEstado("al-dia");
    } catch {
      fijarEstado("no-disponible");
    }
  }

  function forzar() {
    if (pendiente === null) return;
    clearTimeout(temporizador);
    const datoAGuardar = pendiente;
    pendiente = null;
    enviar(datoAGuardar);
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") forzar();
    });
    document.addEventListener("pagehide", forzar);
  }

  function programar(datoAGuardar) {
    pendiente = datoAGuardar;
    fijarEstado("pendiente");
    clearTimeout(temporizador);
    temporizador = setTimeout(forzar, 2500);
  }

  Object.defineProperty(programar, "estadoActual", { get: () => estado });
  return programar;
}
