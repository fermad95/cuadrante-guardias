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
  // Los doce del decreto, mas los dos lunes a los que se trasladan los que
  // caen en domingo (Todos los Santos y la Constitucion).
  assert.equal(Object.keys(c).length, 14);
});

test("los festivos de fecha fija que caen en domingo se trasladan al lunes", () => {
  // Decreto 101/2025 (BOJA): en 2026, 1 de noviembre -> lunes 2 y 6 de diciembre -> lunes 7.
  const c26 = festivosDerivados(2026);
  assert.equal(c26["2026-11-02"].clase, "sdf");
  assert.equal(c26["2026-12-07"].clase, "sdf");
  assert.match(c26["2026-11-02"].nombre, /Todos los Santos/);
  assert.equal(clasificarDia("2026-11-02"), "sdf");
  assert.equal(clasificarDia("2026-12-07"), "sdf");
  // 2027: Dia de Andalucia (28 de febrero) -> lunes 1 de marzo; Asuncion -> lunes 16 de agosto.
  const c27 = festivosDerivados(2027);
  assert.ok(c27["2027-03-01"] && c27["2027-08-16"]);
  assert.equal(c27["2027-03-01"].ambito, "autonomico");
  // Los que no caen en domingo no generan nada: el sabado no se traslada.
  assert.equal(c26["2026-08-17"], undefined); // 15 de agosto de 2026 es sabado
  assert.equal(c26["2026-03-02"], undefined); // 28 de febrero de 2026 es sabado
});

test("un festivo trasladado se puede desmarcar si ese anio no se traslada", () => {
  assert.equal(clasificarDia("2026-11-02", { "2026-11-02": { clase: "laborable" } }), "laborable");
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

import { localesRepetidos } from "../src/festivos.js";

const CORDOBA = {
  "2026-09-08": { nombre: "Ntra. Sra. de la Fuensanta", clase: "sdf" },
  "2026-10-24": { nombre: "San Rafael", clase: "sdf" },
};

test("los festivos locales se repiten solos los anios siguientes, no los anteriores", () => {
  assert.equal(clasificarDia("2027-09-08", CORDOBA), "sdf"); // miercoles
  assert.equal(clasificarDia("2028-09-08", CORDOBA), "sdf");
  assert.equal(clasificarDia("2025-09-08", CORDOBA), "laborable"); // antes del alta: no
  const c = calendarioDe(2027, CORDOBA);
  assert.equal(c["2027-09-08"].nombre, "Ntra. Sra. de la Fuensanta");
  assert.equal(c["2027-09-08"].repetido, true);
  assert.equal(c["2027-10-24"].ambito, "local");
});

test("quitarlo un anio (clase laborable) no afecta a los siguientes", () => {
  const f = { ...CORDOBA, "2027-09-08": { nombre: "Ntra. Sra. de la Fuensanta", clase: "laborable" } };
  assert.equal(clasificarDia("2027-09-08", f), "laborable");
  assert.equal(clasificarDia("2028-09-08", f), "sdf");
  assert.equal(calendarioDe(2027, f)["2027-09-08"].clase, "laborable");
});

test("repetir: false lo deja solo en su anio", () => {
  const f = { "2026-06-13": { nombre: "Feria", clase: "sdf", repetir: false } };
  assert.equal(clasificarDia("2026-06-13", f), "sdf");
  assert.equal(clasificarDia("2027-06-14", f), "laborable");
  assert.deepEqual(localesRepetidos(2027, f), {});
});

test("una reclasificacion de un festivo nacional no se toma por local repetido", () => {
  const f = { "2026-12-08": { clase: "especial" } };
  assert.deepEqual(localesRepetidos(2027, f), {});
  assert.equal(calendarioDe(2027, f)["2027-12-08"].clase, "sdf");
});

test("si cambia de fecha un anio, manda el alta mas reciente", () => {
  const f = { ...CORDOBA, "2028-09-08": { nombre: "Fuensanta (trasladada)", clase: "especial" } };
  assert.equal(calendarioDe(2029, f)["2029-09-08"].nombre, "Fuensanta (trasladada)");
  assert.equal(clasificarDia("2029-09-08", f), "especial");
  assert.equal(clasificarDia("2027-09-08", f), "sdf");
});
