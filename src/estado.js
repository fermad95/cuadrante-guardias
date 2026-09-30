// src/estado.js
import { festivosDerivados } from "./festivos.js";

// Prefijo distinto del original ("cuadrante_v6"): esta copia vive en
// fermad95.github.io/cuadrante-guardias/, que comparte origen (y por tanto
// localStorage) con fermad95.github.io/cuadrante/. Sin un prefijo propio,
// cualquiera que abra las dos URLs en el mismo navegador vería y podria
// sobrescribir los datos de la otra persona, pese a que Firestore ya los
// aisla por cuenta de Google.
export const CLAVE = "cuadrante_guardias_v6";
export const CLAVE_V5 = "cuadrante_guardias_v5";
export const CLAVE_PREVIO = "cuadrante_guardias_v6_previo";

export function estadoInicial() {
  return {
    version: 6,
    actualizadoEn: 0,
    config: {
      inicioResidencia: null,
      cortarAMedianoche: true,
      especialCortaAMedianoche: true,
      retencionBase: 0.089753,
      retencionGuardias: 0.032609,
      retribuciones: null,
      tema: "espacial", // "sobrio" | "espacial"
    },
    guardias: {},
    festivos: {},
    nominas: [],
  };
}

// v5 guardaba el calendario de festivos entero; v6 solo guarda las diferencias
// contra el calendario derivado, para que las mejoras del codigo sigan llegando.
export function migrarV5(v5) {
  const inicial = estadoInicial();
  const festivos = {};
  for (const [fecha, f] of Object.entries(v5.festivos || {})) {
    const derivado = festivosDerivados(Number(fecha.slice(0, 4)))[fecha];
    if (derivado) {
      if (f.clase !== derivado.clase) festivos[fecha] = { clase: f.clase };
    } else if (f.clase !== "laborable") {
      festivos[fecha] = { nombre: f.nombre, clase: f.clase };
    }
  }
  return {
    ...inicial,
    config: { ...inicial.config, ...(v5.config || {}), retribuciones: null },
    guardias: v5.guardias || {},
    festivos,
    nominas: v5.nominas || [],
  };
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ES_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ES_PERIODO = /^\d{4}-\d{2}$/;

function guardiaValida(fecha, g) {
  return ES_FECHA.test(fecha) && g && typeof g === "object"
    && typeof g.horas === "number" && g.horas > 0 && g.horas <= 48
    && (g.inicio === undefined || ES_HORA.test(g.inicio));
}

function nominaValida(n) {
  return n && typeof n === "object"
    && ES_PERIODO.test(n.periodo)
    && (n.clase === "base" || n.clase === "guardias")
    && typeof n.bruto === "number" && n.bruto > 0
    && typeof n.neto === "number" && n.neto > 0 && n.neto <= n.bruto;
}

const CLASES_FESTIVO = ["laborable", "sdf", "especial"];

function festivoValido(fecha, f) {
  return ES_FECHA.test(fecha) && f && typeof f === "object"
    && CLASES_FESTIVO.includes(f.clase)
    && (f.nombre === undefined || typeof f.nombre === "string");
}

const esImporte = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;

function retribucionesValidas(r) {
  if (!r || typeof r !== "object" || !r.guardias || !r.cgFormacion || !esImporte(r.sueldoBase)) return false;
  return [1, 2, 3, 4, 5].every((n) => {
    const g = r.guardias[n];
    return g && typeof g === "object" && CLASES_FESTIVO.every((t) => esImporte(g[t]))
      && typeof r.cgFormacion[n] === "number" && Number.isFinite(r.cgFormacion[n]) && r.cgFormacion[n] >= 0;
  });
}

// Deja la configuracion en un estado con el que la app puede calcular y
// pintar: lo que no tiene la forma esperada vuelve a su valor por defecto.
// Una tabla de tarifas rota, por ejemplo, dejaba la app en blanco al abrir.
export function sanearConfig(config) {
  const inicial = estadoInicial().config;
  const c = { ...inicial, ...(config && typeof config === "object" ? config : {}) };
  if (c.inicioResidencia != null && !(typeof c.inicioResidencia === "string" && ES_FECHA.test(c.inicioResidencia))) {
    c.inicioResidencia = null;
  }
  for (const k of ["cortarAMedianoche", "especialCortaAMedianoche"]) {
    if (typeof c[k] !== "boolean") c[k] = inicial[k];
  }
  for (const k of ["retencionBase", "retencionGuardias"]) {
    if (!(typeof c[k] === "number" && c[k] >= 0 && c[k] < 1)) c[k] = inicial[k];
  }
  if (c.retribuciones !== null && !retribucionesValidas(c.retribuciones)) c.retribuciones = null;
  if ("lugares" in c && !(Array.isArray(c.lugares)
      && c.lugares.every((l) => l && typeof l.sigla === "string" && typeof l.nombre === "string"))) {
    delete c.lugares;
  }
  if (c.tema !== "sobrio" && c.tema !== "espacial") c.tema = inicial.tema;
  return c;
}

// Importa una copia de seguridad pegada a mano. Descarta lo que no sea valido en
// vez de rechazar el lote entero: una copia casi buena sigue sirviendo, y se
// informa de cuantas entradas se han caido. El tema no se importa a proposito:
// es una preferencia de cada dispositivo, no un dato del usuario.
export function importarEstado(texto) {
  let dato;
  try {
    dato = JSON.parse(texto);
  } catch {
    return { ok: false, error: "Eso no es un JSON valido." };
  }
  if (!dato || typeof dato !== "object" || Array.isArray(dato)) {
    return { ok: false, error: "Eso no es una copia del cuadrante." };
  }
  if (!dato.config || typeof dato.config !== "object"
      || !dato.guardias || typeof dato.guardias !== "object" || Array.isArray(dato.guardias)) {
    return { ok: false, error: "A esa copia le faltan datos del cuadrante." };
  }

  const base = Number(dato.version) >= 6 ? dato : migrarV5(dato);
  const inicial = estadoInicial();
  let descartadas = 0;

  const guardias = {};
  for (const [fecha, g] of Object.entries(base.guardias || {})) {
    if (guardiaValida(fecha, g)) guardias[fecha] = g;
    else descartadas += 1;
  }

  const nominas = [];
  for (const n of Array.isArray(base.nominas) ? base.nominas : []) {
    if (nominaValida(n)) nominas.push(n);
    else descartadas += 1;
  }

  // Una fecha de inicio con formato raro romperia el calculo del anio de
  // residencia (NaN silencioso en las tarifas), y una tabla de tarifas rota,
  // todos los calculos: lo que no vale vuelve a su valor por defecto.
  const config = sanearConfig(base.config);
  delete config.tema;

  const festivos = {};
  for (const [fecha, f] of Object.entries(base.festivos || {})) {
    if (festivoValido(fecha, f)) festivos[fecha] = f;
    else descartadas += 1;
  }

  return {
    ok: true,
    descartadas,
    estado: {
      ...inicial,
      config,
      guardias,
      festivos,
      nominas,
      version: 6,
    },
  };
}

function leerJSON(almacen, clave) {
  try {
    const crudo = almacen.getItem(clave);
    if (!crudo) return null;
    const dato = JSON.parse(crudo);
    return dato && typeof dato === "object" ? dato : null;
  } catch {
    return null;
  }
}

// Copia del ultimo estado local antes de que una adopcion remota lo pise. Es
// el respaldo para "restaurar mi copia anterior": vive solo en este
// dispositivo (no viaja a la nube) y la siguiente adopcion la sobrescribe.
export function guardarPrevio(almacen, estado) {
  try { almacen.setItem(CLAVE_PREVIO, JSON.stringify(estado)); } catch { /* sin espacio: no pasa nada */ }
}

export function cargarPrevio(almacen) {
  return leerJSON(almacen, CLAVE_PREVIO);
}

// Compara solo los datos del usuario (config sin el tema, guardias, festivos,
// nominas), ignorando lo que es de cada dispositivo o una marca de tiempo:
// sirve para saber si una adopcion remota va a descartar ediciones locales.
export function mismaData(a, b) {
  if (!a || !b) return false;
  const datos = (e) => {
    const { tema, ...config } = e.config || {};
    return JSON.stringify({
      config,
      guardias: e.guardias || {},
      festivos: e.festivos || {},
      nominas: e.nominas || [],
    });
  };
  return datos(a) === datos(b);
}

// Rellena con el estado inicial las claves que falten en un dato guardado o
// recibido: asi quien no toca una preferencia sigue recibiendo las mejoras
// futuras del codigo en vez de congelar una copia incompleta.
// Tambien descarta lo que no tenga la forma esperada (una guardia sin horas,
// una nomina sin bruto, una tabla de tarifas rota): un dato estropeado en el
// almacenamiento del navegador no puede dejar la app en blanco al abrir.
export function normalizar(dato) {
  const inicial = estadoInicial();
  const mapa = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  return {
    ...inicial,
    ...dato,
    config: sanearConfig(dato.config),
    guardias: Object.fromEntries(Object.entries(mapa(dato.guardias)).filter(([f, g]) => guardiaValida(f, g))),
    festivos: Object.fromEntries(Object.entries(mapa(dato.festivos)).filter(([f, x]) => festivoValido(f, x))),
    nominas: (Array.isArray(dato.nominas) ? dato.nominas : []).filter(nominaValida),
    actualizadoEn: Number(dato.actualizadoEn) || 0,
  };
}

export function cargar(almacen) {
  const guardado = leerJSON(almacen, CLAVE);
  if (guardado) return normalizar(guardado);
  const v5 = leerJSON(almacen, CLAVE_V5);
  return v5 ? normalizar(migrarV5(v5)) : estadoInicial();
}

export function guardar(almacen, estado) {
  almacen.setItem(CLAVE, JSON.stringify(estado));
}
