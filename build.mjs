import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = dirname(fileURLToPath(import.meta.url));
const ORDEN = ["fechas.js", "pascua.js", "tarifas.js", "festivos.js", "motor.js", "nomina.js", "nomina-pdf.js", "estado.js", "persistencia.js", "nube.js", "logo.js", "ui.js"];

function leer(nombre) {
  return readFileSync(join(raiz, "src", nombre), "utf8");
}

function desmodularizar(codigo) {
  return codigo
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+/gm, "")
    .trim();
}

export function construir() {
  const js = ORDEN.map((n) => desmodularizar(leer(n))).join("\n\n");
  return `<meta charset="utf-8">
<title>cuadrante</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${leer("fuentes.css").trim()}
${leer("estilos.css").trim()}
</style>
${leer("plantilla.html").trim()}
<script type="module">
${js}

iniciar(document.body, localStorage);
</script>`;
}

// Documento completo, para servir la app como una pagina normal (GitHub
// Pages) en vez de como fragmento embebido en un Artifact de Claude. Mismo
// codigo, con <head> propio: manifest e iconos para "Anadir a pantalla de
// inicio", que un Artifact no puede ofrecer (el icono ahi lo controla
// claude.ai, no esta pagina).
export function construirDocumento() {
  const js = ORDEN.map((n) => desmodularizar(leer(n))).join("\n\n");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Cuadrante — guardias MIR</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#05070d">
<meta name="description" content="Calendario de guardias MIR, festivos, nóminas y previsión de ingresos.">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>
${leer("fuentes.css").trim()}
${leer("estilos.css").trim()}
</style>
</head>
<body>
${leer("plantilla.html").trim()}
<script type="module">
${js}

iniciar(document.body, localStorage);
</script>
<!-- Fuera de red, la app sigue funcionando gracias al service worker
     (sw.js, servido tal cual por GitHub Pages): la primera visita cachea el
     armazon y las siguientes se sirven sin conexion. Solo en la version de
     GitHub Pages: en el Artifact el registro iria al dominio de claude.ai,
     donde no pinta nada. -->
<script>
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
</script>
</body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(raiz, "cuadrante.html"), construir(), "utf8");
  writeFileSync(join(raiz, "index.html"), construirDocumento(), "utf8");
  console.log("cuadrante.html e index.html generados");
}
