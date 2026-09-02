// src/persistencia.js
//
// El cuadrante vive en un Artifact, y el iframe donde se sirve es de
// terceros para el navegador (frame.claudeusercontent.com dentro de
// claude.ai). Los navegadores moviles, sobre todo Safari, pueden purgar el
// localStorage de un iframe de terceros entre sesiones: por eso las
// guardias desaparecian al cerrar y volver a abrir en el movil.
//
// Ademas de localStorage (instantaneo, por dispositivo), este modulo guarda
// una copia en el propio Artifact usando la capacidad "artifact": vive en
// el servidor, no en el navegador, y sobrevive a esa purga. Si la capacidad
// no esta disponible (fuera de un Artifact, en un visor de solo lectura, o
// en los tests, donde no existe `window`), se queda solo con localStorage,
// igual que antes.
const RUTA = "data/estado.json";
const ESPERA_MS = 2500;

async function capacidad() {
  if (typeof window === "undefined" || !window.claude
      || typeof window.claude.use !== "function") return null;
  try {
    return await window.claude.use("artifact");
  } catch {
    return null;
  }
}

export async function cargarRemoto() {
  if (!(await capacidad())) return null;
  try {
    const resp = await fetch(RUTA);
    if (!resp.ok) return null;
    const dato = await resp.json();
    return dato && typeof dato === "object" && !Array.isArray(dato) ? dato : null;
  } catch {
    return null;
  }
}

// El guardado remoto tiene debounce (ver mas abajo): si se cierra el
// navegador justo despues de editar, el ultimo cambio puede quedarse solo en
// localStorage sin llegar a publicarse. Por eso el remoto NO gana siempre al
// cargar: solo se adopta si es mas reciente que lo que ya hay en este
// dispositivo. `actualizadoEn` es una marca de tiempo que ui.js pone al
// persistir cada cambio.
export function esMasReciente(remoto, local) {
  return (remoto && remoto.actualizadoEn || 0) > (local && local.actualizadoEn || 0);
}

// Debounced: publicar en el Artifact crea una version nueva cada vez, asi
// que no conviene hacerlo en cada tecla. Se espera una pausa antes de enviar,
// pero si la pestana se oculta o se cierra antes de que venza la pausa se
// envia de inmediato, para no perder el ultimo cambio.
//
// `alCambiarEstado(estado)` (opcional) se llama cada vez que cambia el estado
// del guardado, para que la interfaz pueda mostrarlo. La funcion devuelta
// tambien expone `.estadoActual` con el ultimo valor, por si hace falta
// leerlo sin esperar al siguiente cambio (por ejemplo al abrir Ajustes).
// Valores posibles: "comprobando", "al-dia", "pendiente", "no-disponible".
export function creaGuardadoRemoto(alCambiarEstado) {
  let temporizador = null;
  let ultimoEnviado = null;
  let pendiente = null;
  let estado = "comprobando";

  function fijarEstado(nuevo) {
    if (nuevo === estado) return;
    estado = nuevo;
    if (typeof alCambiarEstado === "function") alCambiarEstado(estado);
  }

  capacidad().then((artifact) => {
    // Si mientras tanto ya se ha programado o resuelto un envio, ese estado manda.
    if (estado === "comprobando") fijarEstado(artifact ? "al-dia" : "no-disponible");
  });

  async function enviar(datoAGuardar) {
    const artifact = await capacidad();
    if (!artifact) { fijarEstado("no-disponible"); return; }
    const contenido = JSON.stringify(datoAGuardar);
    if (contenido === ultimoEnviado) { fijarEstado("al-dia"); return; }
    try {
      await artifact.publish({ [RUTA]: contenido });
      ultimoEnviado = contenido;
      fijarEstado("al-dia");
    } catch {
      // Sin red, sin permiso de escritura, o conflicto con otra pestana: el
      // dato sigue a salvo en localStorage y se reintenta en el proximo cambio.
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
    temporizador = setTimeout(forzar, ESPERA_MS);
  }

  Object.defineProperty(programar, "estadoActual", { get: () => estado });
  return programar;
}
