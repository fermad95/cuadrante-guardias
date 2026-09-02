// src/nomina.js
import { redondear, mesDe } from "./fechas.js";
import { calcularGuardia } from "./motor.js";
import { retribucionFija, anioResidenciaEn } from "./tarifas.js";

// La mas reciente, no la media: el IRPF se recalcula cada anio y sube con el anio
// de residencia, asi que promediar una nomina de R1 con una de R3 da un tipo que no
// describe a ninguna de las dos.
function tipoReciente(nominas, clase) {
  const suyas = nominas.filter((n) => n.clase === clase && n.bruto > 0);
  if (suyas.length === 0) return null;
  let mejor = suyas[0];
  for (const n of suyas) {
    if (n.periodo >= mejor.periodo) mejor = n; // >= : la ultima anadida gana el empate
  }
  return Math.round(((mejor.bruto - mejor.neto) / mejor.bruto) * 1e6) / 1e6;
}

export function tiposEfectivos(nominas, config) {
  const base = tipoReciente(nominas, "base");
  const guardias = tipoReciente(nominas, "guardias");
  return {
    base: base === null ? config.retencionBase : base,
    guardias: guardias === null ? config.retencionGuardias : guardias,
    nBase: nominas.filter((n) => n.clase === "base").length,
    nGuardias: nominas.filter((n) => n.clase === "guardias").length,
  };
}

// El tipo de IRPF se regulariza y puede moverse de un mes a otro, sobre todo con
// retribucion variable como las guardias. El historial deja ver la deriva, y
// `esSalto` marca los cambios grandes, que suelen ser una regularizacion.
const SALTO_MINIMO = 0.01; // un punto porcentual

const tasa = (parte, bruto) => Math.round((parte / bruto) * 1e6) / 1e6;

export function historialTipos(nominas, clase) {
  const suyas = nominas
    .filter((n) => n.clase === clase && n.bruto > 0)
    .slice()
    .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
  let anterior = null;      // valor de referencia de la nomina previa
  let anteriorEsIrpf = null; // de que tipo era, para no comparar peras con manzanas
  return suyas.map((n) => {
    const descontado = n.bruto - n.neto;
    const tipo = tasa(descontado, n.bruto);
    const desglosada = n.cotizacion != null && n.irpf != null;
    const tipoCotizacion = desglosada ? tasa(n.cotizacion, n.bruto) : null;
    const tipoIrpf = desglosada ? tasa(n.irpf, n.bruto) : null;

    // La cotizacion va a tipo fijo por ley: lo que deriva es el IRPF. Cuando hay
    // desglose se vigila ese, que es donde esta la senal; si no, el total.
    const referencia = desglosada ? tipoIrpf : tipo;
    const esIrpf = desglosada;
    const comparable = anterior !== null && anteriorEsIrpf === esIrpf;
    const salto = comparable ? Math.round((referencia - anterior) * 1e6) / 1e6 : null;

    const fila = {
      periodo: n.periodo,
      bruto: n.bruto,
      tipo,
      tipoCotizacion,
      tipoIrpf,
      // Un céntimo de margen: los redondeos de la nomina no tienen por que cuadrar exactos.
      cuadra: !desglosada || Math.abs(n.cotizacion + n.irpf - descontado) <= 0.02,
      salto,
      esSalto: salto !== null && Math.abs(salto) >= SALTO_MINIMO,
    };
    anterior = referencia;
    anteriorEsIrpf = esIrpf;
    return fila;
  });
}

export function aplicarRetencion(bruto, tipo) {
  const descuento = redondear(bruto * tipo);
  return { descuento, neto: redondear(bruto - descuento) };
}

export function mesAnterior(anioMes) {
  const [a, m] = anioMes.split("-").map(Number);
  return m === 1
    ? `${a - 1}-12`
    : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export function resumenMes(anioMes, estado) {
  const tipos = tiposEfectivos(estado.nominas, estado.config);
  const anio = anioResidenciaEn(`${anioMes}-15`, estado.config.inicioResidencia);
  const brutoBase = retribucionFija(anio, estado.config).mensual;

  const horasPorTipo = { laborable: 0, sdf: 0, especial: 0 };
  const importePorTipo = { laborable: 0, sdf: 0, especial: 0 };
  let nGuardias = 0;
  let brutoConfirmado = 0;

  for (const [fecha, guardia] of Object.entries(estado.guardias)) {
    if (mesDe(fecha) !== anioMes) continue;
    nGuardias += 1;
    const r = calcularGuardia({ ...guardia, fecha }, estado.festivos, estado.config);
    for (const tipo of ["laborable", "sdf", "especial"]) {
      horasPorTipo[tipo] += r.horasPorTipo[tipo];
      importePorTipo[tipo] = redondear(importePorTipo[tipo] + r.importePorTipo[tipo]);
    }
    if (guardia.hecha) brutoConfirmado = redondear(brutoConfirmado + r.bruto);
  }

  const brutoGuardias = redondear(
    importePorTipo.laborable + importePorTipo.sdf + importePorTipo.especial);
  const base = aplicarRetencion(brutoBase, tipos.base);
  const guardias = aplicarRetencion(brutoGuardias, tipos.guardias);

  return {
    anioMes, nGuardias, horasPorTipo, importePorTipo,
    brutoBase, brutoGuardias, bruto: redondear(brutoBase + brutoGuardias),
    brutoConfirmado,
    // Restado, no sumado aparte: asi las dos partes cuadran siempre con el total
    // aunque los redondeos por tipo y por guardia difieran en algun centimo.
    brutoPrevisto: redondear(brutoGuardias - brutoConfirmado),
    netoBase: base.neto, netoGuardias: guardias.neto,
    neto: redondear(base.neto + guardias.neto),
  };
}

export function previsionIngreso(anioMes, estado) {
  const deEsteMes = resumenMes(anioMes, estado);
  const guardiasDe = mesAnterior(anioMes);
  const delAnterior = resumenMes(guardiasDe, estado);
  return {
    anioMes,
    base: deEsteMes.netoBase,
    guardiasDe,
    importeGuardias: delAnterior.netoGuardias,
    total: redondear(deEsteMes.netoBase + delAnterior.netoGuardias),
  };
}

export function resumenAnio(anio, estado) {
  const meses = Array.from({ length: 12 }, (_, i) =>
    resumenMes(`${anio}-${String(i + 1).padStart(2, "0")}`, estado));
  const horasPorTipo = { laborable: 0, sdf: 0, especial: 0 };
  let bruto = 0;
  let neto = 0;
  for (const m of meses) {
    for (const tipo of ["laborable", "sdf", "especial"]) {
      horasPorTipo[tipo] += m.horasPorTipo[tipo];
    }
    bruto = redondear(bruto + m.bruto);
    neto = redondear(neto + m.neto);
  }
  return { meses, horasPorTipo, bruto, neto };
}

export function compararHipotesis(anioMes, estado) {
  const con = resumenMes(anioMes, {
    ...estado, config: { ...estado.config, cortarAMedianoche: true },
  });
  const sin = resumenMes(anioMes, {
    ...estado, config: { ...estado.config, cortarAMedianoche: false },
  });
  const diferencia = redondear(Math.abs(con.brutoGuardias - sin.brutoGuardias));
  return {
    conCorte: { horasPorTipo: con.horasPorTipo, brutoGuardias: con.brutoGuardias },
    sinCorte: { horasPorTipo: sin.horasPorTipo, brutoGuardias: sin.brutoGuardias },
    difieren: diferencia !== 0,
    diferencia,
  };
}
