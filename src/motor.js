// src/motor.js
import { aMinutos, aHora, diaSiguiente, redondear } from "./fechas.js";
import { clasificarDia } from "./festivos.js";
import { tarifaEn } from "./tarifas.js";

export const INICIO_POR_DURACION = { 7: "15:00", 8: "08:00", 12: "08:00", 15: "17:00", 17: "15:00", 24: "08:00" };

export function inicioSugerido(horas) {
  return INICIO_POR_DURACION[horas] || "15:00";
}

// El horario no depende de la duracion sino del dia, y sale de dos reglas:
// se entra a las 15:00 si hoy se trabaja (despues de la jornada ordinaria) o a
// las 09:00 si no; y se sale a las 08:00 si manana se trabaja o a las 09:00 si
// no. De ahi salen los cuatro casos reales (L-J 17h, V 18h, S 24h, D 23h) y
// ademas quedan resueltos los festivos entre semana sin tabla aparte.
export function sugerenciaPara(fechaISO, festivos = {}) {
  const seTrabajaHoy = clasificarDia(fechaISO, festivos) === "laborable";
  const seTrabajaManana = clasificarDia(diaSiguiente(fechaISO), festivos) === "laborable";
  const inicio = seTrabajaHoy ? "15:00" : "09:00";
  const fin = seTrabajaManana ? "08:00" : "09:00";
  return { horas: (aMinutos(fin) + 1440 - aMinutos(inicio)) / 60, inicio };
}

// `festivos` es el mapa de excepciones del usuario, no un calendario completo:
// el calendario base lo deriva festivos.js a partir del anio de cada fecha.
export function partirGuardia(guardia, festivos, opciones = {}) {
  const cortar = opciones.cortarAMedianoche !== false;
  const cortarEspecial = opciones.especialCortaAMedianoche !== false;
  const inicio = aMinutos(guardia.inicio || inicioSugerido(guardia.horas));
  const total = Math.round(guardia.horas * 60);
  const tipoInicial = clasificarDia(guardia.fecha, festivos);

  const enteraComoInicio =
    !cortar || (!cortarEspecial && tipoInicial === "especial");

  if (enteraComoInicio) {
    return [{
      fecha: guardia.fecha,
      desde: aHora(inicio),
      hasta: aHora(inicio + total),
      horas: guardia.horas,
      tipo: tipoInicial,
    }];
  }

  const tramos = [];
  let fecha = guardia.fecha;
  let desde = inicio;
  let restante = total;
  while (restante > 0) {
    const enEsteDia = Math.min(restante, 1440 - desde);
    tramos.push({
      fecha,
      desde: aHora(desde),
      hasta: aHora(desde + enEsteDia),
      horas: enEsteDia / 60,
      tipo: clasificarDia(fecha, festivos),
    });
    restante -= enEsteDia;
    desde = 0;
    fecha = diaSiguiente(fecha);
  }
  return tramos;
}

export function calcularGuardia(guardia, festivos, config) {
  const tramos = partirGuardia(guardia, festivos, config);
  const horasPorTipo = { laborable: 0, sdf: 0, especial: 0 };
  const importePorTipo = { laborable: 0, sdf: 0, especial: 0 };

  const detallados = tramos.map((t) => {
    const tarifa = tarifaEn(t.fecha, config)[t.tipo];
    const importe = redondear(t.horas * tarifa);
    horasPorTipo[t.tipo] += t.horas;
    importePorTipo[t.tipo] = redondear(importePorTipo[t.tipo] + importe);
    return { ...t, tarifa, importe };
  });

  const bruto = redondear(
    importePorTipo.laborable + importePorTipo.sdf + importePorTipo.especial);
  return { tramos: detallados, horasPorTipo, importePorTipo, bruto };
}
