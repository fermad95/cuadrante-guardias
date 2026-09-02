// test/nube.test.js
//
// Node no sabe hacer `import()` de una URL https, asi que en este entorno
// cargarSDK() siempre falla y se resuelve a null (la misma rama que "sin
// conexion" en un navegador real). Estos tests cubren precisamente esa
// resiliencia: el resto de la app no debe romperse si Firebase no carga.
// El camino feliz (con Firebase de verdad) solo se puede probar en un
// navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cargarNube, creaGuardadoNube, iniciarSesion, cerrarSesion, alCambiarSesion,
} from "../src/nube.js";

test("cargarNube sin SDK disponible devuelve null", async () => {
  assert.equal(await cargarNube(), null);
});

test("alCambiarSesion sin SDK disponible llama con null", async () => {
  const vistos = [];
  alCambiarSesion((u) => vistos.push(u));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(vistos, [null]);
});

test("cerrarSesion sin SDK disponible no lanza", async () => {
  await cerrarSesion();
  assert.ok(true);
});

test("iniciarSesion sin SDK disponible rechaza con un error claro", async () => {
  await assert.rejects(() => iniciarSesion(), /conexion/);
});

test("creaGuardadoNube empieza comprobando y pasa a no-disponible sin sesion", async () => {
  const cambios = [];
  const programar = creaGuardadoNube((e) => cambios.push(e));
  assert.equal(programar.estadoActual, "comprobando");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(programar.estadoActual, "no-disponible");
  programar({ guardias: {} });
  assert.equal(programar.estadoActual, "pendiente");
  await new Promise((r) => setTimeout(r, 2600));
  assert.equal(programar.estadoActual, "no-disponible");
});
