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
  const dia = diaSemana(fechaISO);
  return dia === 0 || dia === 6 ? "sdf" : "laborable";
}

export function calendarioDe(anio, excepciones = {}) {
  // Se copia porque derivadosDe devuelve siempre la misma referencia cacheada:
  // sin la copia, una reclasificacion contaminaria las llamadas siguientes.
  const mapa = { ...derivadosDe(anio) };
  for (const [fecha, exc] of Object.entries(excepciones)) {
    if (Number(fecha.slice(0, 4)) !== anio) continue;
    if (mapa[fecha]) mapa[fecha] = { ...mapa[fecha], clase: exc.clase };
    else if (exc.nombre) mapa[fecha] = { nombre: exc.nombre, ambito: "local", clase: exc.clase };
  }
  return mapa;
}
