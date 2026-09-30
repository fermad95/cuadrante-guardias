// test/fusion.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fusionarEstados, planSincronizacion, mismosDatos, tieneContenido, leerBase, guardarBase,
} from "../src/fusion.js";
import { estadoInicial } from "../src/estado.js";

const g = (horas = 17) => ({ horas, inicio: "15:00", lugar: "", hecha: true });
const nomina = (periodo, clase, bruto = 1000) => ({ periodo, clase, bruto, neto: bruto - 100 });

function copia(actualizadoEn, cambios = {}) {
  const e = estadoInicial();
  e.actualizadoEn = actualizadoEn;
  e.config.inicioResidencia = "2026-05-27";
  return { ...e, ...cambios, config: { ...e.config, ...(cambios.config || {}) } };
}

const plan = (base, local, remoto) => planSincronizacion({ base, local, remoto, ahora: 9999 });

test("mismosDatos no depende del orden de las claves ni del de las nominas", () => {
  const a = copia(1, { guardias: { "2026-07-08": g(), "2026-07-10": g(18) }, nominas: [nomina("2026-07", "base"), nomina("2026-07", "guardias")] });
  const b = copia(2, { guardias: { "2026-07-10": g(18), "2026-07-08": g() }, nominas: [nomina("2026-07", "guardias"), nomina("2026-07", "base")] });
  assert.ok(mismosDatos(a, b));
  assert.ok(!mismosDatos(a, copia(1)));
});

test("mismosDatos ignora el tema, que es de cada dispositivo", () => {
  assert.ok(mismosDatos(copia(1, { config: { tema: "sobrio" } }), copia(1, { config: { tema: "espacial" } })));
});

test("tieneContenido: una copia recien estrenada no tiene nada", () => {
  assert.equal(tieneContenido(estadoInicial()), false);
  assert.equal(tieneContenido(copia(1)), true);
  assert.equal(tieneContenido({ ...estadoInicial(), guardias: { "2026-07-08": g() } }), true);
});

test("movil nuevo: poner la fecha de inicio antes de iniciar sesion no pisa la nube", () => {
  const remoto = copia(1000, { guardias: { "2026-07-08": g() }, nominas: [nomina("2026-07", "guardias")] });
  const local = copia(5000); // solo la fecha de inicio, pero mas reciente
  const p = plan(null, local, remoto);
  assert.equal(p.accion, "adoptar");
  assert.ok(mismosDatos(p.estado, remoto));
  assert.equal(p.estado.actualizadoEn, 1000);
});

test("cambios locales sin subir: se suben tal cual", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g() } });
  const local = copia(2000, { guardias: { "2026-07-08": g(), "2026-09-15": g() } });
  assert.equal(plan(base, local, base).accion, "subir");
});

test("la nube ha cambiado y el local no: se adopta sin perder nada", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g() } });
  const remoto = copia(2000, { guardias: { "2026-07-08": g() }, nominas: [nomina("2026-07", "guardias")] });
  const p = plan(base, base, remoto);
  assert.equal(p.accion, "adoptar");
  assert.equal(p.perdidasLocales, 0);
  assert.equal(p.estado.nominas.length, 1);
});

test("dispositivo con datos de ayer: su guardia nueva no borra lo subido desde otro", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g() } });
  const remoto = copia(2000, { guardias: { "2026-07-08": g() }, nominas: [nomina("2026-08", "base")] });
  const local = copia(3000, { guardias: { "2026-07-08": g(), "2026-09-15": g() } });
  const p = plan(base, local, remoto);
  assert.equal(p.accion, "fusionar");
  assert.deepEqual(Object.keys(p.estado.guardias).sort(), ["2026-07-08", "2026-09-15"]);
  assert.equal(p.estado.nominas.length, 1);
  assert.equal(p.estado.actualizadoEn, 9999);
  assert.equal(p.perdidasLocales, 0);
});

test("un borrado local se respeta si el otro lado no ha tocado ese dato", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g(), "2026-07-10": g(18) } });
  const remoto = copia(2000, { guardias: { "2026-07-08": g(), "2026-07-10": g(18), "2026-08-02": g(23) } });
  const local = copia(3000, { guardias: { "2026-07-08": g() } });
  const p = plan(base, local, remoto);
  assert.deepEqual(Object.keys(p.estado.guardias).sort(), ["2026-07-08", "2026-08-02"]);
});

test("un borrado remoto se respeta si el local no ha tocado ese dato", () => {
  const base = copia(1000, { nominas: [nomina("2026-07", "base"), nomina("2026-07", "guardias")] });
  const remoto = copia(2000, { nominas: [nomina("2026-07", "base")] });
  const p = plan(base, base, remoto);
  assert.equal(p.accion, "adoptar");
  assert.equal(p.estado.nominas.length, 1);
});

test("el mismo dato cambiado en los dos lados: manda la copia mas reciente y se cuenta", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g(17) } });
  const remoto = copia(3000, { guardias: { "2026-07-08": g(24) } });
  const local = copia(2000, { guardias: { "2026-07-08": g(12) } });
  const p = plan(base, local, remoto);
  assert.equal(p.estado.guardias["2026-07-08"].horas, 24);
  assert.equal(p.perdidasLocales, 1);
  const q = plan(base, { ...local, actualizadoEn: 4000 }, remoto);
  assert.equal(q.accion, "subir", "si la local es la mas reciente, se sube tal cual");
  assert.equal(q.perdidasLocales, 0);
});

test("borrado en un lado y cambio en el otro: se conserva el dato cambiado", () => {
  const base = copia(1000, { guardias: { "2026-07-08": g(17) } });
  const remoto = copia(2000, { guardias: { "2026-07-08": g(24) } });
  const local = copia(3000, { guardias: {} }); // lo borro, y es la mas reciente
  const p = plan(base, local, remoto);
  assert.equal(p.estado.guardias["2026-07-08"].horas, 24);
});

test("sin base todo se suma: dos copias con datos distintos no pierden nada", () => {
  const remoto = copia(1000, { guardias: { "2026-07-08": g() }, festivos: { "2026-09-08": { nombre: "Local", clase: "sdf" } } });
  const local = copia(2000, { guardias: { "2026-09-15": g() }, nominas: [nomina("2026-07", "guardias")] });
  const p = plan(null, local, remoto);
  assert.equal(p.accion, "fusionar");
  assert.equal(Object.keys(p.estado.guardias).length, 2);
  assert.equal(Object.keys(p.estado.festivos).length, 1);
  assert.equal(p.estado.nominas.length, 1);
});

test("dispositivo de una version anterior, sin abrir hace dias: lo borrado desde otro no reaparece", () => {
  const local = copia(1000, { guardias: { "2026-07-08": g(), "2026-07-10": g(18) } });
  const remoto = copia(2000, { guardias: { "2026-07-08": g(), "2026-08-02": g(23) } }); // borro la del 10
  const p = planSincronizacion({ base: null, local, remoto, ahora: 9999, copiaDeLaCuenta: true });
  assert.equal(p.accion, "adoptar");
  assert.deepEqual(Object.keys(p.estado.guardias).sort(), ["2026-07-08", "2026-08-02"]);
  // Si lo local es lo mas reciente (cambios sin subir), se suma: no se pierde nada.
  const q = planSincronizacion({ base: null, local: { ...local, actualizadoEn: 3000 }, remoto, ahora: 9999, copiaDeLaCuenta: true });
  assert.deepEqual(Object.keys(q.estado.guardias).sort(), ["2026-07-08", "2026-07-10", "2026-08-02"]);
});

test("los ajustes se fusionan campo a campo", () => {
  const base = copia(1000);
  const remoto = copia(2000, { config: { retencionBase: 0.1 } });
  const local = copia(3000, { config: { lugares: [{ sigla: "UCI", nombre: "UCI" }] } });
  const p = plan(base, local, remoto);
  assert.equal(p.estado.config.retencionBase, 0.1);
  assert.deepEqual(p.estado.config.lugares, [{ sigla: "UCI", nombre: "UCI" }]);
  assert.ok(!("tema" in p.estado.config), "el tema no se fusiona: es de cada dispositivo");
});

test("cuenta sin nada en la nube: se sube solo si hay algo que subir", () => {
  assert.equal(plan(null, copia(1), null).accion, "subir");
  assert.equal(plan(null, estadoInicial(), null).accion, "nada");
});

test("dos dispositivos ya iguales no se escriben el uno al otro (sin vaiven)", () => {
  const a = copia(1000, { guardias: { "2026-07-08": g(), "2026-07-10": g(18) }, nominas: [nomina("2026-07", "base"), nomina("2026-08", "base")] });
  const b = copia(2000, { guardias: { "2026-07-10": g(18), "2026-07-08": g() }, nominas: [nomina("2026-08", "base"), nomina("2026-07", "base")] });
  assert.equal(plan(null, a, b).accion, "nada");
  assert.equal(plan(a, a, b).accion, "nada");
});

test("tras fusionar, el otro dispositivo adopta sin volver a escribir", () => {
  const base = copia(1000, { nominas: [nomina("2026-07", "base")] });
  const deB = copia(2000, { nominas: [nomina("2026-07", "base"), nomina("2026-08", "base")] });
  const deA = copia(3000, { nominas: [nomina("2026-07", "base")], guardias: { "2026-09-15": g() } });
  const enA = plan(base, deA, deB);
  assert.equal(enA.accion, "fusionar");
  const enB = plan(deB, deB, enA.estado);
  assert.equal(enB.accion, "adoptar");
  assert.equal(plan(enB.estado, enB.estado, enA.estado).accion, "nada");
});

test("copias mal formadas no rompen la fusion", () => {
  const p = plan(null, { config: null, guardias: null, nominas: "x" }, copia(1000, { guardias: { "2026-07-08": g() } }));
  assert.equal(Object.keys(p.estado.guardias).length, 1);
  assert.equal(plan(null, null, null).accion, "nada");
});

test("la base se guarda por cuenta y un almacen que falla no rompe nada", () => {
  const m = new Map();
  const almacen = {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
  };
  assert.equal(leerBase(almacen, "c", "uidA"), null);
  guardarBase(almacen, "c", "uidA", { x: 1 });
  assert.deepEqual(leerBase(almacen, "c", "uidA"), { x: 1 });
  assert.equal(leerBase(almacen, "c", "uidB"), null);
  guardarBase(almacen, "c", "uidA", null);
  assert.equal(leerBase(almacen, "c", "uidA"), null);
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  guardarBase(roto, "c", "u", { x: 1 });
  assert.equal(leerBase(roto, "c", "u"), null);
});
