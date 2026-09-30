// test/fusion-azar.test.js
//
// Prueba de estres de la sincronizacion: varios dispositivos de la misma
// cuenta hacen cambios al azar (apuntar, cambiar y borrar guardias, nominas,
// festivos y ajustes) y sincronizan en cualquier orden, igual que lo hace
// `sincronizar()` en ui.js. Al final, pase lo que pase por el camino:
//   - todos los dispositivos y la nube acaban con los mismos datos;
//   - una vez iguales, nadie vuelve a escribir (no hay vaiven);
//   - lo que solo ha tocado un dispositivo queda exactamente como el lo dejo:
//     ni se pierde lo que apunto ni reaparece lo que borro.
// El azar es de semilla fija: si falla, falla siempre igual y dice la semilla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSincronizacion, mismosDatos } from "../src/fusion.js";
import { estadoInicial } from "../src/estado.js";

function azarDe(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const copiar = (x) => JSON.parse(JSON.stringify(x));
const FECHAS = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const PERIODOS = ["2026-07", "2026-08", "2026-09", "2026-10"];
const AJUSTES = ["retencionBase", "retencionGuardias", "cortarAMedianoche"];

// Lo mismo que hace sincronizar() en ui.js con el plan.
function sincronizar(disp, mundo) {
  const remoto = mundo.nube ? copiar(mundo.nube) : null;
  const plan = planSincronizacion({
    base: disp.base, local: disp.local, remoto, ahora: mundo.reloj++, copiaDeLaCuenta: true,
  });
  if (plan.accion === "adoptar" || plan.accion === "fusionar") {
    disp.local = { ...copiar(plan.estado), config: { ...plan.estado.config, tema: disp.local.config.tema } };
  }
  if (plan.accion === "subir" || plan.accion === "fusionar") {
    if (remoto && !(disp.local.actualizadoEn > remoto.actualizadoEn)) disp.local.actualizadoEn = mundo.reloj++;
    mundo.nube = copiar(disp.local);
    mundo.escrituras += 1;
  }
  disp.base = copiar(disp.local);
  return plan.accion;
}

// Un cambio al azar en un dispositivo. Devuelve la clave tocada.
function cambiar(disp, mundo, azar) {
  const e = disp.local;
  const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
  const que = azar();
  let clave;
  if (que < 0.5) {
    const f = elegir(FECHAS);
    clave = `guardia:${f}`;
    if (e.guardias[f] && azar() < 0.4) delete e.guardias[f];
    else e.guardias[f] = { horas: elegir([7, 12, 17, 24]), inicio: "15:00", lugar: elegir(["", "URG", "OBS"]), hecha: azar() < 0.5 };
  } else if (que < 0.75) {
    const p = elegir(PERIODOS);
    const c = elegir(["base", "guardias"]);
    clave = `nomina:${p}|${c}`;
    const i = e.nominas.findIndex((n) => n.periodo === p && n.clase === c);
    if (i >= 0 && azar() < 0.4) e.nominas.splice(i, 1);
    else {
      const n = { periodo: p, clase: c, bruto: 1000 + Math.floor(azar() * 500), neto: 900 };
      if (i >= 0) e.nominas[i] = n; else e.nominas.push(n);
    }
  } else if (que < 0.9) {
    const f = elegir(["2026-09-08", "2026-10-24", "2026-12-25"]);
    clave = `festivo:${f}`;
    if (e.festivos[f] && azar() < 0.4) delete e.festivos[f];
    else e.festivos[f] = { nombre: elegir(["Local", "Feria"]), clase: elegir(["sdf", "especial"]) };
  } else {
    const k = elegir(AJUSTES);
    clave = `ajuste:${k}`;
    e.config[k] = k === "cortarAMedianoche" ? azar() < 0.5 : Math.floor(azar() * 50) / 1000;
  }
  e.actualizadoEn = mundo.reloj++;
  return clave;
}

function valorDe(estado, clave) {
  const [tipo, id] = [clave.slice(0, clave.indexOf(":")), clave.slice(clave.indexOf(":") + 1)];
  if (tipo === "guardia") return estado.guardias[id];
  if (tipo === "festivo") return estado.festivos[id];
  if (tipo === "ajuste") return estado.config[id];
  const [p, c] = id.split("|");
  return estado.nominas.find((n) => n.periodo === p && n.clase === c);
}

function partida(semilla, nDispositivos, nPasos) {
  const azar = azarDe(semilla);
  const inicial = estadoInicial();
  inicial.config.inicioResidencia = "2026-05-27";
  inicial.actualizadoEn = 1;
  const mundo = { nube: copiar(inicial), reloj: 10, escrituras: 0 };
  const dispositivos = Array.from({ length: nDispositivos }, (_, i) => ({
    local: { ...copiar(inicial), config: { ...inicial.config, tema: i % 2 ? "sobrio" : "espacial" } },
    base: copiar(inicial),
  }));
  const tocadaPor = new Map(); // clave -> conjunto de dispositivos que la han tocado

  for (let paso = 0; paso < nPasos; paso++) {
    const i = Math.floor(azar() * nDispositivos);
    if (azar() < 0.6) {
      const clave = cambiar(dispositivos[i], mundo, azar);
      if (!tocadaPor.has(clave)) tocadaPor.set(clave, new Set());
      tocadaPor.get(clave).add(i);
    } else {
      sincronizar(dispositivos[i], mundo);
    }
  }

  // Lo que dejo cada dispositivo en las claves que solo el ha tocado.
  const esperado = new Map();
  for (const [clave, quienes] of tocadaPor) {
    if (quienes.size === 1) esperado.set(clave, copiar(valorDe(dispositivos[[...quienes][0]].local, clave) ?? null));
  }

  // Todos sincronizan dos veces: a la segunda vuelta ya lo han visto todo.
  for (let vuelta = 0; vuelta < 2; vuelta++) for (const d of dispositivos) sincronizar(d, mundo);

  const donde = `semilla ${semilla}`;
  for (const d of dispositivos) assert.ok(mismosDatos(d.local, mundo.nube), `${donde}: un dispositivo no coincide con la nube`);
  const antes = mundo.escrituras;
  for (const d of dispositivos) assert.equal(sincronizar(d, mundo), "nada", `${donde}: ya iguales, alguien vuelve a sincronizar`);
  assert.equal(mundo.escrituras, antes, `${donde}: ya iguales, alguien vuelve a escribir`);
  for (const [clave, valor] of esperado) {
    assert.deepEqual(copiar(valorDe(mundo.nube, clave) ?? null), valor, `${donde}: ${clave} no quedo como lo dejo su unico autor`);
  }
  for (const d of dispositivos) assert.ok(["sobrio", "espacial"].includes(d.local.config.tema), `${donde}: se ha perdido el tema`);
}

test("2 dispositivos, 2000 partidas al azar: convergen, no hay vaiven y no se pierde nada", () => {
  for (let s = 1; s <= 2000; s++) partida(s, 2, 40);
});

test("3 dispositivos, 2000 partidas al azar: convergen, no hay vaiven y no se pierde nada", () => {
  for (let s = 1; s <= 2000; s++) partida(10000 + s, 3, 80);
});

test("5 dispositivos con partidas largas", () => {
  for (let s = 1; s <= 300; s++) partida(50000 + s, 5, 300);
});
