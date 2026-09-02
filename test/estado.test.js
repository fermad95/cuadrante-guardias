// test/estado.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAVE, estadoInicial, cargar, guardar,
  mismaData, guardarPrevio, cargarPrevio, importarEstado,
} from "../src/estado.js";

function almacenFalso(contenido = {}) {
  const datos = { ...contenido };
  return {
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = v; },
    datos,
  };
}

test("el estado inicial no lleva ningun dato personal", () => {
  const e = estadoInicial();
  assert.deepEqual(e.guardias, {});
  assert.deepEqual(e.festivos, {});
  assert.deepEqual(e.nominas, []);
  assert.equal(e.config.inicioResidencia, null);
});

test("el estado inicial arranca con el corte a medianoche activado", () => {
  const e = estadoInicial();
  assert.equal(e.version, 6);
  assert.equal(e.config.cortarAMedianoche, true);
  assert.equal(e.config.especialCortaAMedianoche, true);
  assert.equal(e.config.retribuciones, null);
  assert.equal(e.config.retencionBase, 0.089753);
});

test("el estado inicial no lleva marca de tiempo: nada le gana a un remoto real", () => {
  assert.equal(estadoInicial().actualizadoEn, 0);
});

test("cargar sin nada guardado devuelve el estado inicial", () => {
  assert.deepEqual(cargar(almacenFalso()).guardias, {});
});

test("cargar recupera lo guardado", () => {
  const almacen = almacenFalso();
  const e = estadoInicial();
  e.guardias["2026-09-08"] = { horas: 24, inicio: "08:00" };
  guardar(almacen, e);
  assert.equal(cargar(almacen).guardias["2026-09-08"].horas, 24);
});

test("cargar rellena las claves de configuracion que falten", () => {
  const guardado = JSON.stringify({
    version: 6, config: { inicioResidencia: "2025-05-27" },
    guardias: {}, festivos: {}, nominas: [],
  });
  const e = cargar(almacenFalso({ [CLAVE]: guardado }));
  assert.equal(e.config.inicioResidencia, "2025-05-27");
  assert.equal(e.config.cortarAMedianoche, true);
});

test("un JSON corrupto no rompe la carga", () => {
  assert.deepEqual(cargar(almacenFalso({ [CLAVE]: "{roto" })).guardias, {});
});

test("mismaData ignora el tema y la marca de tiempo", () => {
  const a = estadoInicial();
  const b = estadoInicial();
  b.config.tema = "sobrio";
  b.actualizadoEn = 999;
  assert.equal(mismaData(a, b), true);
  assert.equal(mismaData(a, null), false);
});

test("mismaData detecta ediciones de guardias, festivos y nominas", () => {
  const base = estadoInicial();
  const conGuardia = estadoInicial();
  conGuardia.guardias["2026-09-08"] = { horas: 24, inicio: "08:00" };
  assert.equal(mismaData(base, conGuardia), false);
  const conFestivo = estadoInicial();
  conFestivo.festivos["2026-09-08"] = { nombre: "Fuensanta", clase: "sdf" };
  assert.equal(mismaData(base, conFestivo), false);
  const conNomina = estadoInicial();
  conNomina.nominas = [{ periodo: "2026-07", clase: "base", bruto: 100, neto: 90 }];
  assert.equal(mismaData(base, conNomina), false);
  assert.equal(mismaData(base, base), true);
});

test("guardarPrevio/cargarPrevio guardan y recuperan la copia anterior", () => {
  const almacen = almacenFalso();
  const e = estadoInicial();
  e.guardias["2026-09-08"] = { horas: 24, inicio: "08:00" };
  guardarPrevio(almacen, e);
  const recuperado = cargarPrevio(almacen);
  assert.equal(recuperado.guardias["2026-09-08"].horas, 24);
  assert.equal(cargarPrevio(almacenFalso()), null);
});

test("importarEstado descarta festivos invalidos sin tirar el lote", () => {
  const r = importarEstado(JSON.stringify({
    version: 6,
    config: { inicioResidencia: "2026-05-27" },
    guardias: {},
    festivos: {
      "2026-09-08": { nombre: "Fuensanta", clase: "sdf" },
      "no-es-fecha": { nombre: "Raro", clase: "sdf" },
      "2026-10-24": { nombre: "San Rafael", clase: "inexistente" },
      "2026-11-01": { clase: "especial" },
    },
    nominas: [],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.descartadas, 2);
  assert.deepEqual(Object.keys(r.estado.festivos), ["2026-09-08", "2026-11-01"]);
});

test("importarEstado con fecha de inicio invalida la descarta", () => {
  const r = importarEstado(JSON.stringify({
    version: 6,
    config: { inicioResidencia: "basura" },
    guardias: {}, festivos: {}, nominas: [],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.estado.config.inicioResidencia, null);
});
