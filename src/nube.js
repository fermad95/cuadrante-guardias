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

// Modo standalone (app anadida a pantalla de inicio en iOS): ahi no existe
// ventana para el popup, asi que el login tiene que ir por redireccion.
// `navigator.standalone` es la propiedad de iOS; `display-mode: standalone`
// cubre el resto. En una pestana normal de Safari (no standalone) el popup
// SI funciona con un gesto directo del usuario, y conviene usarlo: el
// redirect depende de que Firebase recupere el estado pendiente tras la
// vuelta a traves de storage de terceros (authDomain distinto del dominio de
// la app), que Safari puede bloquear por ITP — entonces getRedirectResult
// no rechaza, simplemente vuelve sin sesion y sin error, como si "no hubiera
// pasado nada". Verificado en vivo el 31/08/2026: en una pestana normal de
// Safari en iPhone, el login por redireccion llega a ver la pantalla de
// Google y confirma la cuenta, pero vuelve sin sesion iniciada.
function esStandalone() {
  return typeof navigator !== "undefined" && (
    navigator.standalone === true
    || (typeof window !== "undefined" && typeof window.matchMedia === "function"
        && window.matchMedia("(display-mode: standalone)").matches)
  );
}

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
    // Si venimos de un login por redireccion (iOS), la sesion se restaura
    // igual por onAuthStateChanged, pero getRedirectResult cierra el flujo y
    // puede rechazar con el motivo real (dominio no autorizado, almacenamiento
    // bloqueado por Safari, etc.): se reporta en vez de descartarse en
    // silencio, para poder diagnosticar el login atascado en el movil.
    f.authMod.getRedirectResult(f.auth).catch((err) => {
      if (typeof alErrorRedireccion === "function") alErrorRedireccion(err);
    });
  });
}

export async function iniciarSesion() {
  const f = await cargarSDK();
  if (!f) throw new Error("Sin conexion: no se puede iniciar sesion ahora mismo.");
  const proveedor = new f.authMod.GoogleAuthProvider();
  if (esStandalone()) {
    // Solo aqui hace falta redireccion: en standalone no hay ventana donde
    // abrir el popup.
    await f.authMod.signInWithRedirect(f.auth, proveedor);
    return; // la redireccion recarga la pagina; esto no llega a ejecutarse
  }
  await f.authMod.signInWithPopup(f.auth, proveedor);
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
  const act = await uidActual();
  if (!act) return null;
  const { f, uid } = act;
  try {
    const snap = await f.fsMod.getDoc(f.fsMod.doc(f.db, "usuarios", uid));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

// `esMasReciente` (la logica de "gana quien sea mas reciente") se reutiliza
// de persistencia.js: es la misma funcion pura, y por el mismo motivo de
// arriba no puede haber una segunda declaracion con el mismo nombre aqui.

// Debounced + envio inmediato al ocultar la pestana, igual que el guardado
// en el Artifact. `alCambiarEstado(estado)` recibe "comprobando" / "al-dia" /
// "pendiente" / "no-disponible" (no-disponible tambien cuando no hay sesion).
export function creaGuardadoNube(alCambiarEstado) {
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
    // Si ha cambiado de cuenta (cerrar sesion + entrar con otra Google
    // distinta) sin que el estado local haya cambiado, no hay que confiar
    // en el "ya esta enviado" de la cuenta anterior.
    if (uid !== ultimoUid) { ultimoEnviado = null; ultimoUid = uid; }
    const contenido = JSON.stringify(datoAGuardar);
    if (contenido === ultimoEnviado) { fijarEstado("al-dia"); return; }
    try {
      await f.fsMod.setDoc(f.fsMod.doc(f.db, "usuarios", uid), datoAGuardar);
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
