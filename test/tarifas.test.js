// test/tarifas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETRIBUCIONES_ANEXO, anioResidenciaEn, tarifaEn, retribucionFija,
} from "../src/tarifas.js";

const CONFIG = { inicioResidencia: "2026-05-27", retribuciones: null };

test("las tarifas son las del anexo XVI.2", () => {
  const g = RETRIBUCIONES_ANEXO.guardias;
  assert.deepEqual(g[1], { laborable: 14.07, sdf: 15.78, especial: 28.14 });
  assert.deepEqual(g[2], { laborable: 15.42, sdf: 17.28, especial: 30.84 });
  assert.deepEqual(g[3], { laborable: 18.02, sdf: 20.17, especial: 36.04 });
  assert.deepEqual(g[4], { laborable: 20.22, sdf: 22.61, especial: 40.44 });
  assert.deepEqual(g[5], g[4]);
  assert.equal(RETRIBUCIONES_ANEXO.sueldoBase, 1379.90);
});

test("el anio de residencia avanza en la fecha de cambio", () => {
  assert.equal(anioResidenciaEn("2026-08-19", "2026-05-27"), 1);
  assert.equal(anioResidenciaEn("2027-05-26", "2026-05-27"), 1);
  assert.equal(anioResidenciaEn("2027-05-27", "2026-05-27"), 2);
  assert.equal(anioResidenciaEn("2030-06-01", "2026-05-27"), 5);
  assert.equal(anioResidenciaEn("2035-01-01", "2026-05-27"), 5);
  assert.equal(anioResidenciaEn("2026-01-01", "2026-05-27"), 1);
});

test("sin fecha de inicio se asume primer anio", () => {
  assert.equal(anioResidenciaEn("2026-08-19", null), 1);
  assert.equal(anioResidenciaEn("2026-08-19", undefined), 1);
});

test("tarifaEn cruza el cambio de anio", () => {
  assert.equal(tarifaEn("2027-05-26", CONFIG).laborable, 14.07);
  assert.equal(tarifaEn("2027-05-27", CONFIG).laborable, 15.42);
});

test("la retribucion fija reproduce el anexo XVI.1", () => {
  assert.equal(retribucionFija(1, CONFIG).anual, 19318.60);
  assert.equal(retribucionFija(2, CONFIG).anual, 20863.92);
  assert.equal(retribucionFija(3, CONFIG).anual, 22796.34);
  assert.equal(retribucionFija(4, CONFIG).anual, 24727.78);
  assert.equal(retribucionFija(5, CONFIG).anual, 26659.92);
  assert.equal(retribucionFija(2, CONFIG).mensual, 1490.28);
});

test("las retribuciones propias del usuario ganan al anexo", () => {
  const propio = {
    inicioResidencia: "2026-05-27",
    retribuciones: {
      guardias: { 1: { laborable: 20, sdf: 25, especial: 40 } },
      sueldoBase: 1500,
      cgFormacion: { 1: 100 },
    },
  };
  assert.equal(tarifaEn("2026-08-19", propio).laborable, 20);
  assert.equal(retribucionFija(1, propio).mensual, 1600);
});
