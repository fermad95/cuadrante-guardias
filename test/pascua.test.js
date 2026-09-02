// test/pascua.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { domingoDePascua } from "../src/pascua.js";
import { desplazar, diaSemana } from "../src/fechas.js";

test("el domingo de Pascua sale correcto en anios conocidos", () => {
  assert.equal(domingoDePascua(2024), "2024-03-31");
  assert.equal(domingoDePascua(2025), "2025-04-20");
  assert.equal(domingoDePascua(2026), "2026-04-05");
  assert.equal(domingoDePascua(2027), "2027-03-28");
  assert.equal(domingoDePascua(2028), "2028-04-16");
  assert.equal(domingoDePascua(2029), "2029-04-01");
  assert.equal(domingoDePascua(2030), "2030-04-21");
});

test("el domingo de Pascua siempre cae en domingo", () => {
  for (let anio = 2024; anio <= 2040; anio += 1) {
    assert.equal(diaSemana(domingoDePascua(anio)), 0, `${anio}`);
  }
});

test("Jueves y Viernes Santo de 2026 coinciden con los datos ya validados", () => {
  const pascua = domingoDePascua(2026);
  assert.equal(desplazar(pascua, -3), "2026-04-02"); // Jueves Santo
  assert.equal(desplazar(pascua, -2), "2026-04-03"); // Viernes Santo
});

test("desplazar cruza fin de mes, fin de anio y bisiesto", () => {
  assert.equal(desplazar("2026-08-31", 1), "2026-09-01");
  assert.equal(desplazar("2026-12-31", 1), "2027-01-01");
  assert.equal(desplazar("2027-01-01", -1), "2026-12-31");
  assert.equal(desplazar("2028-02-28", 1), "2028-02-29");
  assert.equal(desplazar("2026-04-05", -3), "2026-04-02");
});
