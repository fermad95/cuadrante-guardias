import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAVE_CUENTA, leerCuenta, fijarCuenta, guardarRespaldoCuenta, leerRespaldoCuenta, decidirCuenta,
} from "../src/cuenta.js";
import { CLAVE, estadoInicial } from "../src/estado.js";

function almacenFalso() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

const conGuardia = (fecha, actualizadoEn) => {
  const e = estadoInicial();
  e.actualizadoEn = actualizadoEn;
  e.config.inicioResidencia = "2026-05-27";
  e.guardias = { [fecha]: { horas: 17, inicio: "15:00", hecha: true } };
  return e;
};

test("las claves derivan de CLAVE: cada copia de la app tiene las suyas", () => {
  assert.equal(CLAVE_CUENTA, `${CLAVE}_cuenta`);
});

test("guardar y leer la cuenta y el respaldo", () => {
  const a = almacenFalso();
  assert.equal(leerCuenta(a), null);
  fijarCuenta(a, "uidA");
  assert.equal(leerCuenta(a), "uidA");
  guardarRespaldoCuenta(a, "uidA", { x: 1 });
  assert.deepEqual(leerRespaldoCuenta(a, "uidA"), { x: 1 });
  assert.equal(leerRespaldoCuenta(a, "uidB"), null);
});

test("un almacen que falla no rompe nada", () => {
  const roto = { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("lleno"); } };
  assert.equal(leerCuenta(roto), null);
  fijarCuenta(roto, "x");
  guardarRespaldoCuenta(roto, "x", {});
  assert.equal(leerRespaldoCuenta(roto, "x"), null);
});

test("misma cuenta, o copia local sin dueño (usuarios de antes): regla de siempre", () => {
  assert.deepEqual(decidirCuenta({ duenoLocal: "A", uid: "A", remoto: null, respaldo: null }), { tipo: "misma" });
  assert.deepEqual(decidirCuenta({ duenoLocal: null, uid: "A", remoto: conGuardia("2026-08-05", 1), respaldo: null }), { tipo: "misma" });
});

test("cambio a una cuenta con datos en la nube: se cargan los suyos, no los locales", () => {
  const remotoB = conGuardia("2026-09-01", 100);
  const d = decidirCuenta({ duenoLocal: "A", uid: "B", remoto: remotoB, respaldo: null });
  assert.equal(d.tipo, "otra");
  assert.deepEqual(Object.keys(d.estado.guardias), ["2026-09-01"]);
  assert.equal(d.subir, false);
});

test("cambio a una cuenta nueva sin nada: empieza en blanco (y pregunta la fecha de inicio)", () => {
  const d = decidirCuenta({ duenoLocal: "A", uid: "B", remoto: null, respaldo: null });
  assert.equal(d.tipo, "otra");
  assert.deepEqual(d.estado.guardias, {});
  assert.equal(d.estado.config.inicioResidencia, null);
  assert.equal(d.subir, false);
});

test("volver a la cuenta anterior con cambios sin subir: gana su respaldo y se sube", () => {
  const nubeA = conGuardia("2026-08-05", 100);
  const respaldoA = conGuardia("2026-08-11", 200);
  const d = decidirCuenta({ duenoLocal: "B", uid: "A", remoto: nubeA, respaldo: respaldoA });
  assert.deepEqual(Object.keys(d.estado.guardias), ["2026-08-11"]);
  assert.equal(d.estado.actualizadoEn, 200);
  assert.equal(d.subir, true);
});

test("volver a la cuenta anterior con la nube mas nueva que el respaldo: gana la nube", () => {
  const d = decidirCuenta({
    duenoLocal: "B", uid: "A", remoto: conGuardia("2026-08-05", 300), respaldo: conGuardia("2026-08-11", 200),
  });
  assert.deepEqual(Object.keys(d.estado.guardias), ["2026-08-05"]);
  assert.equal(d.subir, false);
});

test("una nube con basura no se adopta: se empieza en blanco", () => {
  const d = decidirCuenta({ duenoLocal: "A", uid: "B", remoto: { nada: 1 }, respaldo: null });
  assert.equal(d.tipo, "otra");
  assert.deepEqual(d.estado.guardias, {});
});
