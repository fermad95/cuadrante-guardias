// src/festivos.js
import { diaSemana, desplazar } from "./fechas.js";
import { domingoDePascua } from "./pascua.js";

const FIJOS_NACIONALES = [
  ["01-01", "Año Nuevo"],
  ["01-06", "Reyes"],
  ["05-01", "Fiesta del Trabajo"],
  ["08-15", "Asunción"],
  ["10-12", "Fiesta Nacional"],
  ["11-01", "Todos los Santos"],
  ["12-06", "Constitución"],
  ["12-08", "Inmaculada"],
  ["12-25", "Navidad"],
];

export function festivosDerivados(anio) {
  const mapa = {};
  for (const [diaMes, nombre] of FIJOS_NACIONALES) {
    mapa[`${anio}-${diaMes}`] = { nombre, ambito: "nacional", clase: "sdf" };
  }
  const pascua = domingoDePascua(anio);
  mapa[desplazar(pascua, -2)] = { nombre: "Viernes Santo", ambito: "nacional", clase: "sdf" };
  mapa[`${anio}-02-28`] = { nombre: "Día de Andalucía", ambito: "autonomico", clase: "sdf" };
  mapa[desplazar(pascua, -3)] = { nombre: "Jueves Santo", ambito: "autonomico", clase: "sdf" };
  return mapa;
}

const cacheDerivados = new Map();

export function derivadosDe(anio) {
  if (!cacheDerivados.has(anio)) cacheDerivados.set(anio, festivosDerivados(anio));
  return cacheDerivados.get(anio);
}

// Los festivos locales (dos por municipio, casi siempre en la misma fecha
// cada anio) se repiten solos en
// los anios siguientes, en el mismo dia y mes, sin guardar nada nuevo: un
// alta local de un anio vale para los posteriores. Si un anio cambia, basta
// con desmarcarlo ese anio (queda como excepcion con clase "laborable", que
// no se repite) o darlo de alta en otra fecha. `repetir: false` en el alta
// lo deja solo para su anio. Si hay altas del mismo dia en varios anios,
// manda la mas reciente anterior o igual al anio pedido.
export function localesRepetidos(anio, excepciones = {}) {
  const fuentes = {};
  for (const [fecha, exc] of Object.entries(excepciones)) {
    const a = Number(fecha.slice(0, 4));
    if (a >= anio || !exc || !exc.nombre || exc.repetir === false || exc.clase === "laborable") continue;
    if (derivadosDe(a)[fecha]) continue; // reclasificacion de uno nacional/autonomico, no un alta local
    const diaMes = fecha.slice(5);
    if (diaMes === "02-29") continue;
    if (!fuentes[diaMes] || a > fuentes[diaMes].a) fuentes[diaMes] = { a, exc };
  }
  const mapa = {};
  for (const [diaMes, { exc }] of Object.entries(fuentes)) {
    mapa[`${anio}-${diaMes}`] = { nombre: exc.nombre, ambito: "local", clase: exc.clase, repetido: true };
  }
  return mapa;
}

// `excepciones` guarda solo lo que el usuario ha tocado: una entrada con `nombre`
// que no esta en el calendario derivado es un alta local; una sin `nombre` es una
// reclasificacion de un festivo derivado.
export function clasificarDia(fechaISO, excepciones = {}) {
  const marcado = excepciones[fechaISO];
  if (marcado && marcado.clase === "especial") return "especial";
  if (marcado && marcado.clase === "sdf") return "sdf";
  if (!marcado || marcado.clase !== "laborable") {
    if (derivadosDe(Number(fechaISO.slice(0, 4)))[fechaISO]) return "sdf";
  }
  if (!marcado) {
    const repetido = localesRepetidos(Number(fechaISO.slice(0, 4)), excepciones)[fechaISO];
    if (repetido) return repetido.clase === "especial" ? "especial" : "sdf";
  }
  const dia = diaSemana(fechaISO);
  return dia === 0 || dia === 6 ? "sdf" : "laborable";
}

export function calendarioDe(anio, excepciones = {}) {
  // Se copia porque derivadosDe devuelve siempre la misma referencia cacheada:
  // sin la copia, una reclasificacion contaminaria las llamadas siguientes.
  const mapa = { ...derivadosDe(anio) };
  for (const [fecha, f] of Object.entries(localesRepetidos(anio, excepciones))) {
    if (!mapa[fecha]) mapa[fecha] = f;
  }
  for (const [fecha, exc] of Object.entries(excepciones)) {
    if (Number(fecha.slice(0, 4)) !== anio) continue;
    if (mapa[fecha] && mapa[fecha].repetido) {
      mapa[fecha] = { ...mapa[fecha], nombre: exc.nombre || mapa[fecha].nombre, clase: exc.clase };
    } else if (mapa[fecha]) mapa[fecha] = { ...mapa[fecha], clase: exc.clase };
    else if (exc.nombre) mapa[fecha] = { nombre: exc.nombre, ambito: "local", clase: exc.clase };
  }
  return mapa;
}
