// src/estado.js
import { festivosDerivados } from "./festivos.js";

export const CLAVE = "cuadrante_v6";
export const CLAVE_V5 = "cuadrante_v5";
export const CLAVE_PREVIO = "cuadrante_v6_previo";

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

  const config = { ...inicial.config, ...(base.config || {}) };
  delete config.tema;
  // Una fecha de inicio con formato raro romperia el calculo del anio de
  // residencia (NaN silencioso en las tarifas): si no es una fecha valida,
  // se descarta y se vuelve a preguntar.
  if (config.inicioResidencia != null && !ES_FECHA.test(config.inicioResidencia)) {
    config.inicioResidencia = null;
  }

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
export function normalizar(dato) {
  const inicial = estadoInicial();
  return {
    ...inicial,
    ...dato,
    config: { ...inicial.config, ...(dato.config || {}) },
  };
}

export function cargar(almacen) {
  const guardado = leerJSON(almacen, CLAVE);
  if (guardado) return normalizar(guardado);
  const v5 = leerJSON(almacen, CLAVE_V5);
  return v5 ? migrarV5(v5) : estadoInicial();
}

export function guardar(almacen, estado) {
  almacen.setItem(CLAVE, JSON.stringify(estado));
}
