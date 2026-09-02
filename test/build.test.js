// test/build.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { construir, construirDocumento } from "../build.mjs";

test("el html generado es autocontenido", () => {
  const html = construir();
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes("<title>cuadrante</title>"));
  assert.ok(html.includes("14.07"), "debe llevar las tarifas dentro");
  assert.ok(!html.includes("import "), "no puede quedar ningun import");
  assert.ok(!html.match(/^export /m), "no puede quedar ningun export");
  assert.ok(!html.includes("src=\"http"), "no puede pedir nada por red");
  assert.ok(!html.includes("<link"), "el css va inlineado");
});

test("el html arranca la app", () => {
  assert.ok(construir().includes("iniciar(document.body, localStorage)"));
});

test("el bundle lleva el calculo de la Pascua antes de los festivos", () => {
  const html = construir();
  assert.ok(html.includes("domingoDePascua"), "falta el modulo de Pascua");
  assert.ok(
    html.indexOf("function domingoDePascua") < html.indexOf("function festivosDerivados"),
    "pascua.js debe ir antes que festivos.js");
});

test("el bundle no lleva datos personales", () => {
  const html = construir();
  assert.ok(!html.includes("1256.05"), "no puede llevar netos de nominas reales");
  assert.ok(!html.includes("484.83"), "no puede llevar brutos de nominas reales");
  assert.ok(!html.includes("2026-05-27"), "no puede llevar la fecha de inicio de nadie");
  assert.ok(!html.includes("Fuensanta"), "no puede llevar festivos locales de un municipio");
});

test("cada modulo importado esta en el bundle", () => {
  const html = construir();
  for (const simbolo of ["festivosDerivados", "calendarioDe", "clasificarDia",
    "RETRIBUCIONES_ANEXO", "migrarV5", "estadoInicial", "calcularGuardia", "resumenMes"]) {
    assert.ok(html.includes(simbolo), `falta ${simbolo}`);
  }
});

// build.mjs concatena todos los modulos de src/ en un unico <script>: no hay
// bundler de verdad que aisle el ambito de cada uno. Si dos archivos exportan
// una funcion o constante con el mismo nombre, el navegador la rechaza entera
// con un SyntaxError y la app se queda en blanco — no lo pillan los tests de
// los modulos por separado, solo uno que mire el bundle final. Paso en la
// practica el 21/08/2026 con `cargarRemoto` en persistencia.js y nube.js.
function nombresDuplicados(html) {
  const nombres = [...html.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  const vistos = new Set();
  const repetidos = new Set();
  for (const n of nombres) {
    if (vistos.has(n)) repetidos.add(n);
    vistos.add(n);
  }
  return [...repetidos];
}

test("ninguna funcion de nivel superior se declara dos veces en el bundle", () => {
  assert.deepEqual(nombresDuplicados(construir()), []);
  assert.deepEqual(nombresDuplicados(construirDocumento()), []);
});

test("construirDocumento genera un documento HTML completo para GitHub Pages", () => {
  const html = construirDocumento();
  assert.ok(html.startsWith("<!doctype html>"), "debe empezar con el doctype");
  assert.ok(html.includes("<head>") && html.includes("</head>"), "necesita head propio");
  assert.ok(html.includes("<body>") && html.includes("</body>"), "necesita body propio");
  assert.ok(html.includes('<link rel="manifest" href="manifest.json">'), "falta el manifest");
  assert.ok(html.includes('rel="apple-touch-icon"'), "falta el icono de iOS");
  assert.ok(html.includes("iniciar(document.body, localStorage)"), "debe arrancar la app");
  assert.ok(!html.includes("import "), "no puede quedar ningun import estatico");
  assert.ok(!html.match(/^export /m), "no puede quedar ningun export");
  assert.ok(!html.includes("1256.05") && !html.includes("2026-05-27"),
    "no puede llevar datos personales, igual que el fragmento del Artifact");
});

test("solo la version de GitHub Pages registra el service worker", () => {
  const html = construirDocumento();
  assert.ok(html.includes('navigator.serviceWorker.register("sw.js")'),
    "la pagina de GitHub Pages debe registrar el service worker");
  assert.ok(!construir().includes("serviceWorker"),
    "el fragmento del Artifact no debe registrar nada en el dominio de claude.ai");
});

test("solo la version de GitHub Pages lleva los metas de app movil", () => {
  const html = construirDocumento();
  assert.ok(html.includes('name="mobile-web-app-capable"'), "falta el meta de Android/Chrome");
  assert.ok(html.includes('name="apple-mobile-web-app-capable"'), "falta el meta de iOS");
  assert.ok(html.includes('name="apple-mobile-web-app-status-bar-style"'), "falta el estilo de la barra de iOS");
  assert.ok(!construir().includes("apple-mobile-web-app-capable"),
    "el fragmento del Artifact no necesita metas de instalacion");
});

test("el bundle no lleva erratas de texto visibles", () => {
  const html = construir();
  // "Ano Nuevo" en vez de "Año Nuevo" significa otra cosa muy distinta.
  assert.ok(!html.includes("Ano Nuevo"), "Ano Nuevo sin enie");
  assert.ok(!html.includes(">anadir<"), "anadir sin enie en un boton");
  assert.ok(!html.includes("Duracion"), "Duracion sin tilde");
  assert.ok(!html.includes("etiqueta\">//"), "quedan titulos con el // del estilo terminal");
  for (const snake of ["sueldo_base", "bruto_total", "neto_base", "neto_guardias", "total_neto"]) {
    assert.ok(!html.includes(`<td>${snake}<`), `${snake} se muestra al usuario`);
  }
});
