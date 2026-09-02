// test/calendario.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { festivosDerivados, clasificarDia, calendarioDe } from "../src/festivos.js";

test("2026 deriva los mismos festivos nacionales y andaluces que estaban a mano", () => {
  const c = festivosDerivados(2026);
  const esperadas = [
    "2026-01-01", "2026-01-06", "2026-02-28", "2026-04-02", "2026-04-03",
    "2026-05-01", "2026-08-15", "2026-10-12", "2026-11-01", "2026-12-06",
    "2026-12-08", "2026-12-25",
  ];
  for (const f of esperadas) {
    assert.ok(c[f], `falta ${f}`);
  }
  assert.equal(Object.keys(c).length, 12);
});

test("los locales de Cordoba ya no estan en el calendario derivado", () => {
  const c = festivosDerivados(2026);
  assert.equal(c["2026-09-08"], undefined); // Fuensanta
  assert.equal(c["2026-10-24"], undefined); // San Rafael
});

test("Nochebuena y Nochevieja no son festivos", () => {
  const c = festivosDerivados(2026);
  assert.equal(c["2026-12-24"], undefined);
  assert.equal(c["2026-12-31"], undefined);
});

test("la Semana Santa se mueve con el anio", () => {
  assert.equal(festivosDerivados(2026)["2026-04-02"].nombre, "Jueves Santo");
  assert.equal(festivosDerivados(2027)["2027-03-25"].nombre, "Jueves Santo");
  assert.equal(festivosDerivados(2027)["2027-03-26"].nombre, "Viernes Santo");
  assert.equal(festivosDerivados(2027)["2027-04-02"], undefined);
});

test("los festivos existen en todos los anios de una residencia", () => {
  for (const anio of [2026, 2027, 2028, 2029, 2030]) {
    const c = festivosDerivados(anio);
    assert.ok(c[`${anio}-01-01`], `Ano Nuevo de ${anio}`);
    assert.ok(c[`${anio}-12-25`], `Navidad de ${anio}`);
    assert.ok(c[`${anio}-02-28`], `Dia de Andalucia de ${anio}`);
  }
});

test("cada festivo lleva ambito y arranca como sdf", () => {
  const c = festivosDerivados(2026);
  assert.equal(c["2026-01-01"].ambito, "nacional");
  assert.equal(c["2026-02-28"].ambito, "autonomico");
  assert.equal(c["2026-04-02"].ambito, "autonomico");
  assert.equal(c["2026-01-01"].clase, "sdf");
});

test("sin excepciones manda el derivado y luego el dia de la semana", () => {
  assert.equal(clasificarDia("2026-08-05", {}), "laborable"); // miercoles
  assert.equal(clasificarDia("2026-08-02", {}), "sdf");       // domingo
  assert.equal(clasificarDia("2026-06-20", {}), "sdf");       // sabado
  assert.equal(clasificarDia("2026-01-01", {}), "sdf");       // festivo derivado
  assert.equal(clasificarDia("2027-01-01", {}), "sdf");       // y en 2027 tambien
});

test("una excepcion especial gana al derivado y al dia de la semana", () => {
  assert.equal(clasificarDia("2026-01-01", { "2026-01-01": { clase: "especial" } }), "especial");
  assert.equal(clasificarDia("2026-12-24", { "2026-12-24": { clase: "especial" } }), "especial");
});

test("una excepcion laborable desmarca un festivo derivado", () => {
  assert.equal(clasificarDia("2026-01-01", { "2026-01-01": { clase: "laborable" } }), "laborable");
});

test("una excepcion laborable no convierte un domingo en laborable", () => {
  assert.equal(clasificarDia("2026-08-02", { "2026-08-02": { clase: "laborable" } }), "sdf");
});

test("un festivo local dado de alta clasifica como festivo", () => {
  const exc = { "2026-09-08": { nombre: "Fuensanta", clase: "sdf" } };
  assert.equal(clasificarDia("2026-09-08", exc), "sdf"); // martes
});

test("calendarioDe mezcla derivados, altas y reclasificaciones", () => {
  const c = calendarioDe(2026, {
    "2026-01-01": { clase: "especial" },
    "2026-09-08": { nombre: "Fuensanta", clase: "sdf" },
  });
  assert.equal(c["2026-01-01"].clase, "especial");
  assert.equal(c["2026-01-01"].nombre, "Año Nuevo");
  assert.equal(c["2026-09-08"].nombre, "Fuensanta");
  assert.equal(c["2026-09-08"].ambito, "local");
  assert.equal(c["2026-12-25"].clase, "sdf");
});

test("calendarioDe ignora las excepciones de otros anios", () => {
  const c = calendarioDe(2026, { "2027-06-01": { nombre: "X", clase: "sdf" } });
  assert.equal(c["2027-06-01"], undefined);
});

test("calendarioDe no contamina el calendario base entre llamadas", () => {
  calendarioDe(2026, { "2026-12-25": { clase: "especial" } });
  assert.equal(calendarioDe(2026, {})["2026-12-25"].clase, "sdf");
});
