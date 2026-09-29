import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { horarioLiquidado } from "../src/motor.js";
import { resumenMes, resumenAnio, contrasteGuardias, ingresoDelMes } from "../src/nomina.js";
import { estadoInicial, importarEstado, normalizar } from "../src/estado.js";
import { parsearNomina } from "../src/nomina-pdf.js";

// Guardias reales de julio y agosto de 2026, con el horario que se hizo de
// verdad (confirmado por el usuario): L-J 15:00 17h, V 15:00 18h, S 09:00 24h,
// D 09:00 23h. Julio se liquido en la complementaria de agosto y agosto en la
// de septiembre; los PDF reales estan en test/fixtures.
const GUARDIAS = {
  "2026-07-08": { horas: 17, inicio: "15:00", hecha: true },
  "2026-07-10": { horas: 18, inicio: "15:00", hecha: true },
  "2026-07-18": { horas: 24, inicio: "09:00", hecha: true },
  "2026-07-23": { horas: 17, inicio: "15:00", hecha: true },
  "2026-07-28": { horas: 17, inicio: "15:00", hecha: true },
  "2026-08-02": { horas: 23, inicio: "09:00", hecha: true },
  "2026-08-05": { horas: 17, inicio: "15:00", hecha: true },
  "2026-08-11": { horas: 17, inicio: "15:00", hecha: true },
  "2026-08-13": { horas: 17, inicio: "15:00", hecha: true },
};

const nominaPdf = (nombre) => parsearNomina(
  readFileSync(new URL(`./fixtures/${nombre}.txt`, import.meta.url), "utf8")).nomina;

function estadoReal(extra = {}) {
  const e = estadoInicial();
  e.config.inicioResidencia = "2026-05-27";
  Object.assign(e.config, extra);
  e.guardias = structuredClone(GUARDIAS); // copia: algun test borra guardias
  return e;
}

test("horario SAS: 09:00 de entrada o salida se liquida como 08:00", () => {
  assert.deepEqual(horarioLiquidado({ horas: 18, inicio: "15:00" }), { horas: 17, inicio: "15:00" }); // viernes
  assert.deepEqual(horarioLiquidado({ horas: 23, inicio: "09:00" }), { horas: 24, inicio: "08:00" }); // domingo
  assert.deepEqual(horarioLiquidado({ horas: 24, inicio: "09:00" }), { horas: 24, inicio: "08:00" }); // sabado
  assert.deepEqual(horarioLiquidado({ horas: 17, inicio: "15:00" }), { horas: 17, inicio: "15:00" }); // L-J
  // Guardias cortas que no cruzan la medianoche no se tocan.
  assert.deepEqual(horarioLiquidado({ horas: 12, inicio: "09:00" }), { horas: 12, inicio: "09:00" });
});

test("con horario SAS la app reproduce al centimo las dos complementarias reales", () => {
  const e = estadoReal({ horarioSAS: true });
  const julio = resumenMes("2026-07", e);
  assert.deepEqual(julio.horasPorTipo, { laborable: 60, sdf: 32, especial: 0 });
  assert.equal(julio.brutoGuardias, 1349.16);
  const agosto = resumenMes("2026-08", e);
  assert.deepEqual(agosto.horasPorTipo, { laborable: 59, sdf: 16, especial: 0 });
  assert.equal(agosto.brutoGuardias, 1082.61);
});

test("sin horario SAS se mantiene el calculo por horario real de antes", () => {
  const e = estadoReal({ horarioSAS: false });
  assert.equal(resumenMes("2026-07", e).brutoGuardias, 1364.94);
  assert.equal(resumenMes("2026-08", e).brutoGuardias, 1066.83);
});

test("por defecto se calculan las horas reales, no el horario del SAS", () => {
  assert.equal(estadoInicial().config.horarioSAS, undefined);
  assert.equal(resumenMes("2026-08", estadoReal()).brutoGuardias, 1066.83);
});

test("contraste agosto: el SAS pago 1h festiva mas que las hechas, por su horario 08-08", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("complementaria-2026-08")];
  const c = contrasteGuardias("2026-08", e);
  assert.equal(c.cuadra, false);
  assert.deepEqual(c.diferencias, { sdf: 1 });
  assert.equal(c.diferenciaImporte, 15.78);
  assert.equal(c.porHorarioSAS, true);
  assert.equal(c.prorrataVacaciones, 599.30);
  assert.equal(c.diasVacaciones, 15);
});

test("contraste julio: el SAS pago 1h festiva menos (15,78 EUR a reclamar)", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("complementaria-2026-07")];
  const c = contrasteGuardias("2026-07", e);
  assert.deepEqual(c.diferencias, { sdf: -1 });
  assert.equal(c.diferenciaImporte, -15.78);
  assert.equal(c.porHorarioSAS, true);
});

test("contraste: si falta una guardia en el calendario, se ve la diferencia de horas", () => {
  const e = estadoReal();
  delete e.guardias["2026-08-13"];
  e.nominas = [nominaPdf("complementaria-2026-08")];
  const c = contrasteGuardias("2026-08", e);
  assert.equal(c.cuadra, false);
  assert.deepEqual(c.diferencias, { laborable: 17, sdf: 1 });
  assert.equal(c.porHorarioSAS, false);
});

test("una nomina guardada antes de esta version (sin desglose) no da contraste ni se rompe", () => {
  const e = estadoReal();
  e.nominas = [{ periodo: "2026-07", clase: "guardias", bruto: 1349.16, neto: 1279.18, cotizacion: 69.98, irpf: 0 }];
  assert.equal(contrasteGuardias("2026-07", e), null);
  // Y el ingreso usa igualmente su neto real.
  assert.equal(ingresoDelMes("2026-08", e).importeGuardias, 1279.18);
});

test("ingreso de septiembre con las dos nominas reales: 1182,78 + 1500,83", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("normal-2026-09"), nominaPdf("complementaria-2026-08")];
  const i = ingresoDelMes("2026-09", e);
  assert.equal(i.baseReal, true);
  assert.equal(i.guardiasReal, true);
  assert.equal(i.total, 2683.61);
  assert.equal(i.prorrataVacaciones, 599.30);
});

test("el desglose sobrevive a la copia de seguridad y a la normalizacion", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("complementaria-2026-08")];
  const r = importarEstado(JSON.stringify(e));
  assert.equal(r.ok, true);
  assert.deepEqual(r.estado.nominas, e.nominas);
  assert.deepEqual(normalizar(JSON.parse(JSON.stringify(e))).nominas, e.nominas);
});

test("un estado guardado por otro usuario antes de esta version se lee sin cambiar sus datos", () => {
  const antiguo = {
    version: 6, actualizadoEn: 123,
    config: { inicioResidencia: "2026-05-27", cortarAMedianoche: true, especialCortaAMedianoche: true,
      retencionBase: 0.089753, retencionGuardias: 0.032609, retribuciones: null },
    guardias: { "2026-08-05": { horas: 17, inicio: "15:00", hecha: true } },
    festivos: {},
    nominas: [{ periodo: "2026-07", clase: "guardias", bruto: 1349.16, neto: 1279.18 }],
  };
  const copia = JSON.parse(JSON.stringify(antiguo));
  const n = normalizar(copia);
  assert.deepEqual(n.guardias, antiguo.guardias);
  assert.deepEqual(n.nominas, antiguo.nominas);
  assert.deepEqual(copia, antiguo, "normalizar no muta el dato recibido");
});

test("contraste en una cuenta sin guardias apuntadas ese mes: lo dice en vez de dar una diferencia falsa", () => {
  const e = estadoReal();
  e.guardias = {};
  e.nominas = [nominaPdf("complementaria-2026-08")];
  const c = contrasteGuardias("2026-08", e);
  assert.equal(c.calendarioVacio, true);
});

test("resumen de un mes con nominas reales: el neto es el de las nominas, no una prevision", () => {
  const e = estadoReal();
  e.nominas = [
    { periodo: "2026-07", clase: "base", bruto: 1379.9, neto: 1256.05, cotizacion: 123.85, irpf: 0 },
    nominaPdf("complementaria-2026-07"),
    nominaPdf("normal-2026-09"), // la mas reciente, ya con IRPF: no debe contaminar julio
    nominaPdf("complementaria-2026-08"),
  ];
  const julio = resumenMes("2026-07", e);
  assert.equal(julio.netoBase, 1256.05);
  assert.equal(julio.netoGuardias, 1279.18);
  assert.equal(julio.neto, 2535.23);
  assert.equal(julio.netoBaseReal && julio.netoGuardiasReal, true);
  // Octubre no tiene nominas: sigue siendo prevision con la retencion mas reciente.
  const octubre = resumenMes("2026-10", e);
  assert.equal(octubre.netoBaseReal, false);
  assert.equal(octubre.netoBase, 1182.78);
});

import { pagaExtraPrevista, diferenciasConSAS } from "../src/nomina.js";

test("paga extra: diciembre completo, junio prorrateado desde el inicio, y R2 cuando toca", () => {
  const c = { inicioResidencia: "2026-05-27", retribuciones: null };
  assert.equal(pagaExtraPrevista("2026-12", c), 1379.9);
  assert.equal(pagaExtraPrevista("2026-06", c), 37.91); // 5 dias de 182
  assert.equal(pagaExtraPrevista("2027-12", c), 1490.28); // R2: sueldo + CG 110,38
  assert.equal(pagaExtraPrevista("2026-07", c), 0);
  assert.equal(pagaExtraPrevista("2026-11", c), 0);
});

test("resumen de diciembre: la paga extra entra en el bruto y solo retiene IRPF", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("normal-2026-09")]; // IRPF 5,31 %
  const dic = resumenMes("2026-12", e);
  const nov = resumenMes("2026-11", e);
  assert.equal(dic.pagaExtra, 1379.9);
  assert.equal(dic.bruto, Math.round((nov.bruto + 1379.9) * 100) / 100);
  // 1379,90 x (1 - 0,0531) = 1306,63: el neto sube eso respecto a noviembre.
  assert.equal(Math.round((dic.netoBase - nov.netoBase) * 100) / 100, 1306.63);
});

test("resumen anual: 14 pagas (12 mensualidades + 2 extra)", () => {
  const e = estadoInicial();
  e.config.inicioResidencia = "2025-12-01"; // R1 todo 2026 salvo diciembre (R2 desde el 01/12)
  const r = resumenAnio(2026, e);
  // 11 meses R1 + diciembre R2 + dos pagas extra de semestres enteros en R1.
  assert.equal(r.bruto, Math.round((13 * 1379.9 + 1490.28) * 100) / 100);
});

test("diferencias con el SAS: julio te deben 15,78, agosto 15,78 de mas, saldo 0; marcar reclamada", () => {
  const e = estadoReal();
  e.nominas = [nominaPdf("complementaria-2026-07"), nominaPdf("complementaria-2026-08")];
  let r = diferenciasConSAS(e);
  assert.deepEqual(r.filas.map((f) => [f.periodo, f.diferencia]), [["2026-07", -15.78], ["2026-08", 15.78]]);
  assert.equal(r.pendienteReclamar, 15.78);
  assert.equal(r.pagadoDeMas, 15.78);
  assert.equal(r.saldo, 0);
  e.nominas[0].reclamada = "2026-09-29";
  r = diferenciasConSAS(e);
  assert.equal(r.pendienteReclamar, 0);
  assert.equal(r.filas[0].reclamada, "2026-09-29");
  // La marca sobrevive a la copia de seguridad / sincronizacion.
  assert.equal(importarEstado(JSON.stringify(e)).estado.nominas[0].reclamada, "2026-09-29");
});

test("diferencias: meses sin calendario o sin desglose no cuentan", () => {
  const e = estadoReal();
  e.guardias = {};
  e.nominas = [nominaPdf("complementaria-2026-08"), { periodo: "2026-06", clase: "guardias", bruto: 484.83, neto: 469.02 }];
  assert.deepEqual(diferenciasConSAS(e).filas, []);
});
