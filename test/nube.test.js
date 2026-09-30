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
  cargarNube, creaSincronizador, escribirNube, iniciarSesion, cerrarSesion, alCambiarSesion, entrarConGoogle,
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

test("escribirNube sin SDK disponible no escribe y lo dice", async () => {
  assert.equal(await escribirNube("uid", { guardias: {} }), false);
});

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test("creaSincronizador: ahora() ejecuta la tarea y refleja el resultado", async () => {
  const cambios = [];
  let resultado = "al-dia";
  const s = creaSincronizador(async () => resultado, (e) => cambios.push(e));
  assert.equal(s.estadoActual, "comprobando");
  assert.equal(await s.ahora(), "al-dia");
  assert.equal(s.estadoActual, "al-dia");
  resultado = "no-disponible";
  await s.ahora();
  assert.equal(s.estadoActual, "no-disponible");
  assert.deepEqual(cambios, ["al-dia", "no-disponible"]);
});

test("creaSincronizador: una tarea que lanza cuenta como no disponible", async () => {
  const s = creaSincronizador(async () => { throw new Error("sin red"); });
  assert.equal(await s.ahora(), "no-disponible");
  assert.equal(s.estadoActual, "no-disponible");
});

test("creaSincronizador: programar espera una pausa y junta varios cambios en una sola tarea", async () => {
  let veces = 0;
  const s = creaSincronizador(async () => { veces += 1; return "al-dia"; });
  s.programar();
  s.programar();
  assert.equal(s.estadoActual, "pendiente");
  await pausa(300);
  assert.equal(veces, 0, "no sincroniza en cada cambio");
  await pausa(2400);
  assert.equal(veces, 1);
  assert.equal(s.estadoActual, "al-dia");
});

test("creaSincronizador: nunca corren dos tareas a la vez, y lo pedido durante una se repite al acabar", async () => {
  let enMarcha = 0;
  let maximo = 0;
  let veces = 0;
  const s = creaSincronizador(async () => {
    enMarcha += 1; maximo = Math.max(maximo, enMarcha); veces += 1;
    await pausa(40);
    enMarcha -= 1;
    return "al-dia";
  });
  const a = s.ahora();
  const b = s.ahora();
  assert.equal(a, b, "la segunda peticion se une a la que esta en curso");
  await a;
  assert.equal(maximo, 1);
  assert.equal(veces, 2);
});

test("creaSincronizador: un cambio hecho durante una tarea sigue pendiente al acabar", async () => {
  let veces = 0;
  const s = creaSincronizador(async () => { veces += 1; await pausa(40); return "al-dia"; });
  const a = s.ahora();
  s.programar();
  await a;
  assert.equal(s.estadoActual, "pendiente");
  await pausa(2600);
  assert.equal(veces, 2);
  assert.equal(s.estadoActual, "al-dia");
});

// El login con Google. En el iPhone con la app en la pantalla de inicio la
// redireccion vuelve sin sesion (Safari no deja a Firebase recuperar el
// resultado: authDomain no es el dominio de la app), asi que el popup va
// siempre primero y la redireccion solo queda para cuando no hay popup.
function authFalso(errorPopup) {
  const llamadas = [];
  return {
    llamadas,
    GoogleAuthProvider: class {},
    signInWithPopup: async () => { llamadas.push("popup"); if (errorPopup) throw errorPopup; },
    signInWithRedirect: async () => { llamadas.push("redireccion"); },
  };
}

test("entrarConGoogle usa el popup tambien con la app en la pantalla de inicio", async () => {
  const nav = globalThis.navigator;
  if (nav) Object.defineProperty(nav, "standalone", { value: true, configurable: true });
  try {
    const m = authFalso();
    await entrarConGoogle(m, {});
    assert.deepEqual(m.llamadas, ["popup"]);
  } finally {
    if (nav) delete nav.standalone;
  }
});

test("entrarConGoogle cae a la redireccion solo si no se puede abrir el popup", async () => {
  for (const code of ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"]) {
    const m = authFalso(Object.assign(new Error("x"), { code }));
    await entrarConGoogle(m, {});
    assert.deepEqual(m.llamadas, ["popup", "redireccion"], code);
  }
});

test("entrarConGoogle no redirige si el usuario cierra el popup", async () => {
  const m = authFalso(Object.assign(new Error("cerrado"), { code: "auth/popup-closed-by-user" }));
  await assert.rejects(() => entrarConGoogle(m, {}), /cerrado/);
  assert.deepEqual(m.llamadas, ["popup"]);
});
