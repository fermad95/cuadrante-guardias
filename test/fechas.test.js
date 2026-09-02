// test/fechas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { diaSemana, diaSiguiente, aMinutos, aHora, mesDe, diasDelMes } from "../src/fechas.js";

test("diaSemana identifica el dia de la semana", () => {
  assert.equal(diaSemana("2026-08-19"), 3); // miercoles
  assert.equal(diaSemana("2026-08-02"), 0); // domingo
  assert.equal(diaSemana("2026-06-20"), 6); // sabado
});

test("diaSemana no se descoloca por la zona horaria", () => {
  assert.equal(diaSemana("2026-01-01"), 4); // jueves
  assert.equal(diaSemana("2026-12-25"), 5); // viernes
});

test("diaSiguiente cruza fin de mes y fin de anio", () => {
  assert.equal(diaSiguiente("2026-08-02"), "2026-08-03");
  assert.equal(diaSiguiente("2026-08-31"), "2026-09-01");
  assert.equal(diaSiguiente("2026-12-31"), "2027-01-01");
  assert.equal(diaSiguiente("2028-02-28"), "2028-02-29"); // bisiesto
});

test("aMinutos y aHora son inversas dentro del dia", () => {
  assert.equal(aMinutos("15:00"), 900);
  assert.equal(aMinutos("08:30"), 510);
  assert.equal(aHora(900), "15:00");
  assert.equal(aHora(510), "08:30");
});

test("aHora marca el desbordamiento al dia siguiente", () => {
  assert.equal(aHora(1440), "24:00");
  assert.equal(aHora(1920), "08:00 +1");
});

test("mesDe y diasDelMes", () => {
  assert.equal(mesDe("2026-08-02"), "2026-08");
  const dias = diasDelMes("2026-08");
  assert.equal(dias.length, 31);
  assert.equal(dias[0], "2026-08-01");
  assert.equal(dias[30], "2026-08-31");
  assert.equal(diasDelMes("2026-02").length, 28);
});
