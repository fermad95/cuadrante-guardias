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

// Si la carga falla (sin red), no se memoriza el fallo: la siguiente llamada
// vuelve a intentarlo. Ojo: eso solo sirve en Safari y Firefox. Chrome
// recuerda el fallo de un import() hasta recargar la pagina (comprobado el
// 30/09/2026 en Chrome 154), asi que lo que de verdad evita quedarse sin
// nube es que el service worker (sw.js) guarde el SDK: con la copia guardada
// carga siempre, haya o no cobertura. La version de CDN tiene que coincidir
// con la de sw.js (lo vigila test/build.test.js).
function cargarSDK() {
  if (!sdkPromesa) {
    const intento = Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]).then(([appMod, authMod, fsMod]) => {
      const app = appMod.initializeApp(CONFIG);
      return { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), authMod, fsMod };
    }).catch(() => {
      if (sdkPromesa === intento) sdkPromesa = null;
      return null;
    });
    sdkPromesa = intento;
  }
  return sdkPromesa;
}

// Llama a `fn(usuario | null)` cada vez que cambia la sesion. `usuario` es
// `{ uid, nombre, correo, foto }` o `null` si no hay sesion. Si el SDK no
// carga (sin red), se llama una vez con null y se vuelve a intentar cuando
// vuelve la conexion o la app vuelve a primer plano.
export function alCambiarSesion(fn, alErrorRedireccion) {
  let suscrito = false;
  let avisadoSinSDK = false;
  const intentar = () => cargarSDK().then((f) => {
    if (suscrito) return;
    if (!f) {
      if (!avisadoSinSDK) { avisadoSinSDK = true; fn(null); }
      return;
    }
    suscrito = true;
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
  intentar();
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", intentar);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") intentar();
    });
  }
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

// Escribe el estado en la nube de `uid`, y solo si la sesion sigue siendo la
// de esa cuenta: si ha cambiado mientras tanto, no se escribe nada (los datos
// de una cuenta nunca van a la nube de otra). Devuelve si se ha escrito.
export async function escribirNube(uid, dato) {
  const act = await uidActual();
  if (!act || act.uid !== uid) return false;
  try {
    // Se envia una copia ya serializada, no el objeto vivo: Firestore rechaza
    // cualquier campo `undefined` y el guardado entero fallaria.
    await act.f.fsMod.setDoc(act.f.fsMod.doc(act.f.db, "usuarios", uid), JSON.parse(JSON.stringify(dato)));
    return true;
  } catch {
    return false;
  }
}

// Decide CUANDO se sincroniza; el COMO lo pone `tarea` (ui.js), que lee la
// nube, fusiona y escribe, y devuelve "al-dia" o "no-disponible".
//   programar()  tras cada cambio: espera una pausa (no se sincroniza en cada
//                tecla), pero si la pestana se oculta o se cierra antes, va ya
//   ahora()      sin esperar (al iniciar sesion, al volver a primer plano, al
//                recuperar la conexion); devuelve una promesa con el resultado
// Nunca corren dos a la vez: si se pide otra durante una, se repite al acabar.
// `estadoActual`: "comprobando" / "al-dia" / "pendiente" / "no-disponible".
export function creaSincronizador(tarea, alCambiarEstado) {
  let temporizador = null;
  let estado = "comprobando";
  let pendiente = false; // hay cambios locales esperando a la pausa
  let enCurso = null;
  let otraVez = false;

  function fijarEstado(nuevo) {
    if (nuevo === estado) return;
    estado = nuevo;
    if (typeof alCambiarEstado === "function") alCambiarEstado(estado);
  }

  function ahora() {
    if (enCurso) { otraVez = true; return enCurso; }
    clearTimeout(temporizador);
    pendiente = false;
    enCurso = (async () => {
      let resultado;
      do {
        otraVez = false;
        try { resultado = await tarea(); } catch { resultado = "no-disponible"; }
      } while (otraVez);
      enCurso = null;
      // Si ha habido un cambio nuevo mientras tanto, sigue "pendiente".
      if (!pendiente) fijarEstado(resultado === "al-dia" ? "al-dia" : "no-disponible");
      return resultado;
    })();
    return enCurso;
  }

  function programar() {
    pendiente = true;
    fijarEstado("pendiente");
    clearTimeout(temporizador);
    temporizador = setTimeout(ahora, 2500);
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    const siPendiente = () => { if (pendiente) ahora(); };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") siPendiente();
    });
    document.addEventListener("pagehide", siPendiente);
  }

  return { programar, ahora, get estadoActual() { return estado; } };
}
