import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenMes, mesAnterior, previsionIngreso, resumenAnio } from "../src/nomina.js";
import { redondear } from "../src/fechas.js";

const ESTADO = {
  config: {
    inicioResidencia: "2026-05-27",
    retencionBase: 0.089753,
    retencionGuardias: 0.032609,
  },
  festivos: {},
  nominas: [],
  guardias: {
    "2026-06-08": { horas: 7, inicio: "15:00", hecha: true },
    "2026-06-15": { horas: 7, inicio: "15:00", hecha: true },
    "2026-06-20": { horas: 12, inicio: "08:00", hecha: true },
    "2026-06-26": { horas: 7, inicio: "15:00", hecha: true },
    "2026-08-02": { horas: 15, inicio: "17:00", lugar: "PTA" },
    "2026-08-03": { horas: 8, inicio: "08:00" },
    "2026-08-05": { horas: 17, inicio: "15:00", lugar: "OBS" },
    "2026-08-11": { horas: 17, inicio: "15:00", lugar: "PTA" },
    "2026-08-13": { horas: 17, inicio: "15:00" },
  },
};

test("mesAnterior cruza el cambio de anio", () => {
  assert.equal(mesAnterior("2026-08"), "2026-07");
  assert.equal(mesAnterior("2026-01"), "2025-12");
});

test("junio reproduce la nomina real: 21h laborables y 12h festivas", () => {
  const r = resumenMes("2026-06", ESTADO);
  assert.equal(r.horasPorTipo.laborable, 21);
  assert.equal(r.horasPorTipo.sdf, 12);
  assert.equal(r.horasPorTipo.especial, 0);
  assert.equal(r.importePorTipo.laborable, 295.47);
  assert.equal(r.importePorTipo.sdf, 189.36);
  assert.equal(r.brutoGuardias, 484.83);
  assert.equal(r.netoGuardias, 469.02);
});

test("el sueldo base entra en todos los meses", () => {
  const r = resumenMes("2026-07", ESTADO);
  assert.equal(r.brutoBase, 1379.90);
  assert.equal(r.netoBase, 1256.05);
  assert.equal(r.brutoGuardias, 0);
  assert.equal(r.nGuardias, 0);
});

test("agosto con corte a medianoche", () => {
  const r = resumenMes("2026-08", ESTADO);
  assert.equal(r.horasPorTipo.laborable, 67);
  assert.equal(r.horasPorTipo.sdf, 7);
  assert.equal(r.brutoGuardias, 1053.15);
});

test("agosto sin corte a medianoche", () => {
  const estado = { ...ESTADO, config: { ...ESTADO.config, cortarAMedianoche: false } };
  const r = resumenMes("2026-08", estado);
  assert.equal(r.horasPorTipo.laborable, 59);
  assert.equal(r.horasPorTipo.sdf, 15);
  assert.equal(r.brutoGuardias, 1066.83);
});

test("una guardia que cruza de mes cuenta en el mes en que empieza", () => {
  const estado = {
    ...ESTADO,
    guardias: { "2026-07-31": { horas: 17, inicio: "15:00" } },
  };
  // El 31 de julio de 2026 es viernes: 9h de viernes y 8h del sabado 1 de agosto.
  // Las 17 horas se atribuyen a julio, el mes en que empieza, pero cada tramo
  // conserva la tarifa de su propio dia natural.
  assert.equal(resumenMes("2026-07", estado).nGuardias, 1);
  assert.equal(resumenMes("2026-08", estado).nGuardias, 0);
  const r = resumenMes("2026-07", estado);
  assert.equal(r.horasPorTipo.laborable, 9);
  assert.equal(r.horasPorTipo.sdf, 8);
  assert.equal(r.importePorTipo.laborable, 126.63);
  assert.equal(r.importePorTipo.sdf, 126.24);
  assert.equal(r.brutoGuardias, 252.87);
});

test("la prevision de ingreso cobra las guardias del mes anterior", () => {
  const p = previsionIngreso("2026-07", ESTADO);
  assert.equal(p.guardiasDe, "2026-06");
  assert.equal(p.base, 1256.05);
  assert.equal(p.importeGuardias, 469.02);
  assert.equal(p.total, 1725.07);
});

test("las guardias de agosto se cobran en septiembre", () => {
  const p = previsionIngreso("2026-09", ESTADO);
  assert.equal(p.guardiasDe, "2026-08");
  assert.ok(p.importeGuardias > 1000);
});

test("el resumen anual suma los doce meses", () => {
  const r = resumenAnio(2026, ESTADO);
  assert.equal(r.meses.length, 12);
  assert.equal(r.horasPorTipo.laborable, 88); // 21 de junio + 67 de agosto
  assert.equal(r.horasPorTipo.sdf, 19);       // 12 de junio + 7 de agosto
});

test("las guardias hechas y las previstas se separan", () => {
  const estado = {
    ...ESTADO,
    guardias: {
      "2026-08-05": { horas: 17, inicio: "15:00", hecha: true },
      "2026-08-11": { horas: 17, inicio: "15:00", hecha: false },
    },
  };
  const r = resumenMes("2026-08", estado);
  assert.equal(r.brutoConfirmado, 239.19);
  assert.equal(r.brutoPrevisto, 239.19);
  assert.equal(r.brutoGuardias, 478.38);
});

test("una guardia sin marcar cuenta como prevista", () => {
  const estado = {
    ...ESTADO,
    guardias: { "2026-08-05": { horas: 17, inicio: "15:00" } },
  };
  const r = resumenMes("2026-08", estado);
  assert.equal(r.brutoConfirmado, 0);
  assert.equal(r.brutoPrevisto, 239.19);
});

test("confirmado y previsto siempre suman el total", () => {
  const r = resumenMes("2026-08", ESTADO);
  assert.equal(redondear(r.brutoConfirmado + r.brutoPrevisto), r.brutoGuardias);
});

test("un mes sin guardias reparte ceros", () => {
  const r = resumenMes("2026-07", ESTADO);
  assert.equal(r.brutoConfirmado, 0);
  assert.equal(r.brutoPrevisto, 0);
});
