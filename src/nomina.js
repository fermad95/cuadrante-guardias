// src/nomina.js
import { redondear, mesDe, diaSiguiente } from "./fechas.js";
import { calcularGuardia } from "./motor.js";
import { retribucionFija, anioResidenciaEn, retribucionesDe } from "./tarifas.js";

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

// Pagas extraordinarias: 14 pagas al anio (anexo XVI: el total anual del R1
// es 14 x 1.379,90). Se cobran en junio y diciembre y cada una se devenga en
// el semestre anterior (junio: 1 dic-31 may; diciembre: 1 jun-30 nov), a
// razon de una mensualidad (sueldo + CG de formacion) por semestre completo.
// Si la residencia empezo dentro del semestre, se prorratea por dias; y si
// el anio de residencia cambia a mitad, cada dia cuenta con el suyo. Es una
// PREVISION: la regla es la general del SAS, sin confirmar aun con una nomina
// real de junio o diciembre de este residente.
export function pagaExtraPrevista(anioMes, config) {
  const [a, m] = anioMes.split("-").map(Number);
  if (m !== 6 && m !== 12) return 0;
  const desde = m === 6 ? `${a - 1}-12-01` : `${a}-06-01`;
  const hasta = m === 6 ? `${a}-05-31` : `${a}-11-30`;
  const inicio = config.inicioResidencia;
  let dias = 0;
  let suma = 0;
  for (let d = desde; d <= hasta; d = diaSiguiente(d)) {
    dias += 1;
    if (inicio && d < inicio) continue;
    suma += retribucionFija(anioResidenciaEn(d, inicio), config).mensual;
  }
  return redondear(suma / dias);
}

// IRPF de la ultima nomina base con desglose: la paga extra no cotiza a la
// Seguridad Social en su mes (va prorrateada en las bases mensuales), solo
// retiene IRPF. Sin ese dato se usa el tipo total de la base, que es mayor:
// mejor quedarse corto que prometer de mas.
function tipoIrpfBase(nominas, config) {
  const suyas = nominas.filter((n) => n.clase === "base" && n.bruto > 0 && typeof n.irpf === "number");
  if (suyas.length === 0) return tiposEfectivos(nominas, config).base;
  let mejor = suyas[0];
  for (const n of suyas) if (n.periodo >= mejor.periodo) mejor = n;
  return mejor.irpf / mejor.bruto;
}

export function resumenMes(anioMes, estado) {
  const tipos = tiposEfectivos(estado.nominas, estado.config);
  const anio = anioResidenciaEn(`${anioMes}-15`, estado.config.inicioResidencia);
  const brutoBase = retribucionFija(anio, estado.config).mensual;

  const horasPorTipo = { laborable: 0, sdf: 0, especial: 0 };
  const importePorTipo = { laborable: 0, sdf: 0, especial: 0 };
  const config = configConPrecios(estado);
  let nGuardias = 0;
  let brutoConfirmado = 0;

  for (const [fecha, guardia] of Object.entries(estado.guardias)) {
    if (mesDe(fecha) !== anioMes) continue;
    nGuardias += 1;
    const r = calcularGuardia({ ...guardia, fecha }, estado.festivos, config);
    for (const tipo of ["laborable", "sdf", "especial"]) {
      horasPorTipo[tipo] += r.horasPorTipo[tipo];
      importePorTipo[tipo] = redondear(importePorTipo[tipo] + r.importePorTipo[tipo]);
    }
    if (guardia.hecha) brutoConfirmado = redondear(brutoConfirmado + r.bruto);
  }

  const brutoGuardias = redondear(
    importePorTipo.laborable + importePorTipo.sdf + importePorTipo.especial);
  // Si el mes ya tiene nomina real, el neto es el de la nomina, no una
  // prevision con la retencion de hoy (que puede llevar un IRPF que ese mes
  // aun no existia). El bruto por tipo sigue saliendo del calendario: son las
  // horas hechas, y lo que el SAS pago de mas o de menos se ve en el contraste.
  const nominaBase = nominaDe(estado.nominas, anioMes, "base");
  const nominaGuardias = nominaDe(estado.nominas, anioMes, "guardias");
  const pagaExtra = pagaExtraPrevista(anioMes, estado.config);
  const netoBase = nominaBase
    ? nominaBase.neto
    : redondear(aplicarRetencion(brutoBase, tipos.base).neto
      + aplicarRetencion(pagaExtra, tipoIrpfBase(estado.nominas, estado.config)).neto);
  const netoGuardias = nominaGuardias
    ? nominaGuardias.neto : aplicarRetencion(brutoGuardias, tipos.guardias).neto;

  return {
    anioMes, nGuardias, horasPorTipo, importePorTipo,
    brutoBase, pagaExtra, brutoGuardias, bruto: redondear(brutoBase + pagaExtra + brutoGuardias),
    brutoConfirmado,
    // Restado, no sumado aparte: asi las dos partes cuadran siempre con el total
    // aunque los redondeos por tipo y por guardia difieran en algun centimo.
    brutoPrevisto: redondear(brutoGuardias - brutoConfirmado),
    netoBase, netoGuardias,
    netoBaseReal: Boolean(nominaBase), netoGuardiasReal: Boolean(nominaGuardias),
    neto: redondear(netoBase + netoGuardias),
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

// La nomina registrada de ese periodo y clase, si la hay (la ultima anadida
// gana si hubiera dos, igual que en tipoReciente).
export function nominaDe(nominas, periodo, clase) {
  let hallada = null;
  for (const n of nominas) if (n.periodo === periodo && n.clase === clase) hallada = n;
  return hallada;
}

// Lo que ingresas en `anioMes`: la nomina real si ya esta registrada y, si no,
// la prevision. Cada parte por separado, porque la base y las guardias llegan
// en PDF distintos y puede estar registrada una y la otra no.
export function ingresoDelMes(anioMes, estado) {
  const p = previsionIngreso(anioMes, estado);
  const base = nominaDe(estado.nominas, anioMes, "base");
  const guardias = nominaDe(estado.nominas, p.guardiasDe, "guardias");
  const baseNeto = base ? base.neto : p.base;
  const guardiasNeto = guardias ? guardias.neto : p.importeGuardias;
  return {
    ...p,
    base: baseNeto,
    importeGuardias: guardiasNeto,
    baseReal: Boolean(base),
    guardiasReal: Boolean(guardias),
    prorrataVacaciones: guardias?.desglose?.prorrataVacaciones || 0,
    total: redondear(baseNeto + guardiasNeto),
  };
}

// Compara lo que liquido el SAS en la complementaria de `anioMes` con lo que
// sale de las guardias del calendario. Solo hay contraste si la nomina trae
// desglose de horas (las importadas de PDF desde esta version); las
// registradas antes, o a mano, no lo tienen y se devuelve null.
export function contrasteGuardias(anioMes, estado) {
  const n = nominaDe(estado.nominas, anioMes, "guardias");
  const horas = n?.desglose?.horas;
  if (!horas || typeof horas !== "object") return null;
  const r = resumenMes(anioMes, estado);
  const diferencias = {};
  for (const tipo of ["laborable", "sdf", "especial"]) {
    const d = redondear((Number(horas[tipo]) || 0) - r.horasPorTipo[tipo]);
    if (d !== 0) diferencias[tipo] = d;
  }
  const liquidado = Number(n.desglose.guardias) || 0;
  // Si la diferencia es exactamente la que sale de liquidar con el horario
  // tipo del SAS (08:00 a 08:00), se dice: es la causa conocida.
  const sas = resumenMes(anioMes, { ...estado, config: { ...estado.config, horarioSAS: true } });
  const porHorarioSAS = Object.keys(diferencias).length > 0
    && ["laborable", "sdf", "especial"].every((t) => (Number(horas[t]) || 0) === sas.horasPorTipo[t]);
  return {
    liquidadas: { laborable: Number(horas.laborable) || 0, sdf: Number(horas.sdf) || 0, especial: Number(horas.especial) || 0 },
    calculadas: r.horasPorTipo,
    diferencias,
    cuadra: Object.keys(diferencias).length === 0,
    // Sin ninguna guardia apuntada ese mes no hay nada con que comparar: la
    // diferencia seria la nomina entera y no significa nada.
    calendarioVacio: r.nGuardias === 0,
    importeLiquidado: liquidado,
    importeCalculado: r.brutoGuardias,
    diferenciaImporte: redondear(liquidado - r.brutoGuardias),
    porHorarioSAS,
    prorrataVacaciones: Number(n.desglose.prorrataVacaciones) || 0,
    diasVacaciones: n.desglose.diasVacaciones ?? null,
  };
}

// Todas las diferencias entre lo que liquido el SAS y las horas del
// calendario, mes a mes, con el saldo. `reclamada` se guarda en la propia
// nomina (fecha en que se marco), asi viaja con ella y una version antigua
// de la app la conserva al sincronizar.
export function diferenciasConSAS(estado) {
  const meses = [...new Set(estado.nominas.filter((n) => n.clase === "guardias").map((n) => n.periodo))].sort();
  const filas = [];
  for (const periodo of meses) {
    const c = contrasteGuardias(periodo, estado);
    if (!c || c.calendarioVacio || c.diferenciaImporte === 0) continue;
    const n = nominaDe(estado.nominas, periodo, "guardias");
    filas.push({
      periodo,
      diferencia: c.diferenciaImporte,
      diferencias: c.diferencias,
      porHorarioSAS: c.porHorarioSAS,
      reclamada: typeof n.reclamada === "string" ? n.reclamada : null,
    });
  }
  const suma = (lista) => redondear(lista.reduce((s, f) => s + f.diferencia, 0));
  const aReclamar = filas.filter((f) => f.diferencia < 0 && !f.reclamada);
  return {
    filas,
    pendienteReclamar: redondear(-suma(aReclamar)) || 0, // sin nada pendiente, 0 y no -0
    pagadoDeMas: suma(filas.filter((f) => f.diferencia > 0)),
    saldo: suma(filas),
  };
}

// Precios por hora de cada complementaria con desglose, por mes liquidado,
// para que tarifaEn calcule ese mes con lo que pago el SAS de verdad.
function preciosDeNominas(estado) {
  const mapa = {};
  for (const n of estado.nominas) {
    const p = n.clase === "guardias" && n.desglose && n.desglose.precios;
    if (!p || typeof p !== "object") continue;
    const precios = {};
    for (const t of ["laborable", "sdf", "especial"]) if (Number(p[t]) > 0) precios[t] = Number(p[t]);
    if (Object.keys(precios).length === 0) continue;
    mapa[n.periodo] = { anio: anioResidenciaEn(`${n.periodo}-15`, estado.config.inicioResidencia), precios };
  }
  return mapa;
}

export function configConPrecios(estado) {
  return { ...estado.config, preciosNomina: preciosDeNominas(estado) };
}

// Compara los precios de la ultima complementaria con la tabla con la que la
// app hace las previsiones (anexo XVI o lo puesto en Ajustes). Si no
// coinciden, el convenio ha cambiado (o la tabla esta mal) y las previsiones
// de los meses siguientes se quedarian desfasadas.
export function tarifasDesfasadas(estado) {
  const conPrecios = estado.nominas
    .filter((n) => n.clase === "guardias" && n.desglose && n.desglose.precios && typeof n.desglose.precios === "object")
    .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
  const ultima = conPrecios[conPrecios.length - 1];
  if (!ultima) return null;
  const anio = anioResidenciaEn(`${ultima.periodo}-15`, estado.config.inicioResidencia);
  const tabla = retribucionesDe(estado.config).guardias[anio];
  const distintos = {};
  for (const t of ["laborable", "sdf", "especial"]) {
    const real = Number(ultima.desglose.precios[t]);
    if (real > 0 && Math.abs(real - tabla[t]) > 0.004) distintos[t] = { nomina: real, app: tabla[t] };
  }
  return Object.keys(distintos).length ? { periodo: ultima.periodo, anio, distintos } : null;
}

// Resumen anual en CSV para Excel en espanol: separador ";", coma decimal y
// BOM para que abra bien las tildes. Una fila por mes con lo calculado y, si
// la hay, la nomina real (bruto, neto, cotizacion, IRPF), mas una de totales.
export function csvAnual(anio, estado) {
  const r = resumenAnio(anio, estado);
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(2).replace(".", ",") : "");
  const horas = (x) => String(x).replace(".", ",");
  const cab = ["Mes", "Horas laborables", "Horas festivas", "Horas festivo especial",
    "Bruto base", "Paga extra", "Bruto guardias", "Bruto total",
    "Neto base", "Neto guardias", "Neto total", "Origen del neto",
    "Nomina base: bruto", "neto", "cotizacion", "IRPF",
    "Nomina guardias: bruto", "neto", "cotizacion", "IRPF", "prorrata vacaciones"];
  const filas = [cab];
  const suma = {};
  const acumula = (k, v) => { if (typeof v === "number") suma[k] = redondear((suma[k] || 0) + v); };
  for (const m of r.meses) {
    const b = nominaDe(estado.nominas, m.anioMes, "base");
    const g = nominaDe(estado.nominas, m.anioMes, "guardias");
    const origen = m.netoBaseReal && (m.netoGuardiasReal || m.brutoGuardias === 0) ? "nomina real"
      : m.netoBaseReal || m.netoGuardiasReal ? "mixto" : "prevision";
    const fila = [m.anioMes, horas(m.horasPorTipo.laborable), horas(m.horasPorTipo.sdf), horas(m.horasPorTipo.especial),
      num(m.brutoBase), num(m.pagaExtra), num(m.brutoGuardias), num(m.bruto),
      num(m.netoBase), num(m.netoGuardias), num(m.neto), origen,
      num(b?.bruto), num(b?.neto), num(b?.cotizacion), num(b?.irpf),
      num(g?.bruto), num(g?.neto), num(g?.cotizacion), num(g?.irpf), num(g?.desglose?.prorrataVacaciones)];
    filas.push(fila);
    [["bb", m.brutoBase], ["pe", m.pagaExtra], ["bg", m.brutoGuardias], ["bt", m.bruto], ["nb", m.netoBase],
      ["ng", m.netoGuardias], ["nt", m.neto], ["rbb", b?.bruto], ["rbn", b?.neto], ["rbc", b?.cotizacion],
      ["rbi", b?.irpf], ["rgb", g?.bruto], ["rgn", g?.neto], ["rgc", g?.cotizacion], ["rgi", g?.irpf],
      ["rgp", g?.desglose?.prorrataVacaciones]].forEach(([k, v]) => acumula(k, v));
  }
  filas.push([`Total ${anio}`, horas(r.horasPorTipo.laborable), horas(r.horasPorTipo.sdf), horas(r.horasPorTipo.especial),
    num(suma.bb), num(suma.pe), num(suma.bg), num(suma.bt), num(suma.nb), num(suma.ng), num(suma.nt), "",
    num(suma.rbb), num(suma.rbn), num(suma.rbc), num(suma.rbi), num(suma.rgb), num(suma.rgn), num(suma.rgc),
    num(suma.rgi), num(suma.rgp)]);
  const celda = (x) => (/[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return "\uFEFF" + filas.map((f) => f.map((x) => celda(String(x))).join(";")).join("\r\n") + "\r\n";
}
