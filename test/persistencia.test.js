// test/persistencia.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargarRemoto, creaGuardadoRemoto, esMasReciente } from "../src/persistencia.js";

function documentFalso() {
  const manejadores = {};
  return {
    visibilityState: "visible",
    addEventListener: (evento, fn) => {
      (manejadores[evento] ||= []).push(fn);
    },
    disparar(evento) {
      for (const fn of manejadores[evento] || []) fn();
    },
  };
}

test("cargarRemoto sin window.claude no intenta nada y devuelve null", async () => {
  assert.equal(await cargarRemoto(), null);
});

test("cargarRemoto devuelve null si la capacidad no esta disponible", async () => {
  globalThis.window = { claude: { use: async () => null } };
  try {
    assert.equal(await cargarRemoto(), null);
  } finally {
    delete globalThis.window;
  }
});

test("cargarRemoto lee y parsea el fichero remoto", async () => {
  const estadoGuardado = { version: 6, guardias: { "2026-09-08": { horas: 24 } } };
  globalThis.window = { claude: { use: async () => ({}) } };
  globalThis.fetch = async () => ({ ok: true, json: async () => estadoGuardado });
  try {
    const remoto = await cargarRemoto();
    assert.equal(remoto.guardias["2026-09-08"].horas, 24);
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test("cargarRemoto devuelve null si el fetch falla", async () => {
  globalThis.window = { claude: { use: async () => ({}) } };
  globalThis.fetch = async () => ({ ok: false });
  try {
    assert.equal(await cargarRemoto(), null);
  } finally {
    delete globalThis.window;
    delete globalThis.fetch;
  }
});

test("creaGuardadoRemoto no publica sin window.claude", async () => {
  const programar = creaGuardadoRemoto();
  programar({ guardias: {} });
  // Se espera a que el propio temporizador se consuma dentro de este test,
  // para no dejar un envio pendiente que contamine los tests siguientes.
  await new Promise((r) => setTimeout(r, 2600));
  assert.ok(true); // no lanza, simplemente no hace nada
});

test("estadoActual pasa de comprobando a no-disponible sin window.claude", async () => {
  const programar = creaGuardadoRemoto();
  assert.equal(programar.estadoActual, "comprobando");
  await new Promise((r) => setTimeout(r, 10)); // deja resolver la comprobacion inicial
  assert.equal(programar.estadoActual, "no-disponible");
});

test("estadoActual pasa a al-dia cuando la capacidad esta disponible desde el inicio", async () => {
  globalThis.window = { claude: { use: async () => ({}) } };
  try {
    const programar = creaGuardadoRemoto();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(programar.estadoActual, "al-dia");
  } finally {
    delete globalThis.window;
  }
});

test("estadoActual pasa por pendiente y vuelve a al-dia tras publicar, avisando por el callback", async () => {
  const cambios = [];
  globalThis.window = {
    claude: { use: async () => ({ publish: async () => ({ version: "1" }) }) },
  };
  try {
    const programar = creaGuardadoRemoto((e) => cambios.push(e));
    await new Promise((r) => setTimeout(r, 10)); // comprobando -> al-dia
    programar({ guardias: { a: 1 } });
    assert.equal(programar.estadoActual, "pendiente");
    await new Promise((r) => setTimeout(r, 2600));
    assert.equal(programar.estadoActual, "al-dia");
    assert.deepEqual(cambios, ["al-dia", "pendiente", "al-dia"]);
  } finally {
    delete globalThis.window;
  }
});

test("estadoActual pasa a no-disponible si publicar falla", async () => {
  globalThis.window = {
    claude: { use: async () => ({ publish: async () => { throw new Error("not_writer"); } }) },
  };
  try {
    const programar = creaGuardadoRemoto();
    programar({ guardias: { a: 1 } });
    await new Promise((r) => setTimeout(r, 2600));
    assert.equal(programar.estadoActual, "no-disponible");
  } finally {
    delete globalThis.window;
  }
});

test("creaGuardadoRemoto publica el estado tras la pausa, una sola vez por rafaga", async () => {
  const publicados = [];
  globalThis.window = {
    claude: {
      use: async () => ({
        publish: async (ficheros) => { publicados.push(ficheros); return { version: "1" }; },
      }),
    },
  };
  try {
    const programar = creaGuardadoRemoto();
    programar({ guardias: { a: 1 } });
    programar({ guardias: { a: 1, b: 2 } }); // reemplaza el envio anterior, aun no vencido
    await new Promise((r) => setTimeout(r, 2600));
    assert.equal(publicados.length, 1);
    const contenido = JSON.parse(publicados[0]["data/estado.json"]);
    assert.deepEqual(contenido.guardias, { a: 1, b: 2 });
  } finally {
    delete globalThis.window;
  }
});

test("esMasReciente: gana quien tenga la marca de tiempo mas alta", () => {
  assert.equal(esMasReciente({ actualizadoEn: 5 }, { actualizadoEn: 2 }), true);
  assert.equal(esMasReciente({ actualizadoEn: 2 }, { actualizadoEn: 5 }), false);
  assert.equal(esMasReciente({ actualizadoEn: 5 }, { actualizadoEn: 5 }), false);
});

test("esMasReciente sin marca de tiempo se trata como cero", () => {
  assert.equal(esMasReciente({}, {}), false);
  assert.equal(esMasReciente({ actualizadoEn: 1 }, {}), true);
  assert.equal(esMasReciente(null, { actualizadoEn: 1 }), false);
});

test("creaGuardadoRemoto envia de inmediato si la pestana se oculta antes de la pausa", async () => {
  const publicados = [];
  globalThis.document = documentFalso();
  globalThis.window = {
    claude: {
      use: async () => ({
        publish: async (ficheros) => { publicados.push(ficheros); return { version: "1" }; },
      }),
    },
  };
  try {
    const programar = creaGuardadoRemoto();
    programar({ guardias: { a: 1 } });
    globalThis.document.disparar("pagehide");
    await new Promise((r) => setTimeout(r, 20)); // enviar() es async, deja que corra
    assert.equal(publicados.length, 1);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("creaGuardadoRemoto no vuelve a publicar si el estado no cambio", async () => {
  const publicados = [];
  globalThis.window = {
    claude: {
      use: async () => ({
        publish: async (ficheros) => { publicados.push(ficheros); return { version: "1" }; },
      }),
    },
  };
  try {
    const programar = creaGuardadoRemoto();
    const estado = { guardias: { a: 1 } };
    programar(estado);
    await new Promise((r) => setTimeout(r, 2600));
    programar(estado);
    await new Promise((r) => setTimeout(r, 2600));
    assert.equal(publicados.length, 1);
  } finally {
    delete globalThis.window;
  }
});
