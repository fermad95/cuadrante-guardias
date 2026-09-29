// banco/construir.mjs
//
// Prepara el banco de pruebas de sincronizacion: la app real (el mismo HTML
// que se publica) con el SDK de Firebase sustituido por el simulado de
// banco/fb, y dos cuentas de prueba sacadas de las nominas de test/fixtures.
// Uso: `npm run banco` y abrir http://localhost:8770/ en el navegador.
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { construirDocumento } from "../build.mjs";
import { parsearNomina } from "../src/nomina-pdf.js";
import { CLAVE } from "../src/estado.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const CDN = "https://www.gstatic.com/firebasejs/10.13.2";

const html = construirDocumento();
if (!html.includes(CDN)) throw new Error(`No encuentro el CDN de Firebase (${CDN}) en la app: actualiza banco/construir.mjs.`);
writeFileSync(join(aqui, "app.html"), html.replace(CDN, "./fb"));

const fixture = (n) => parsearNomina(readFileSync(join(aqui, "..", "test", "fixtures", `${n}.txt`), "utf8")).nomina;
const g = (horas, inicio, lugar = "") => ({ horas, inicio, lugar, hecha: true });
const config = {
  inicioResidencia: "2026-05-27", cortarAMedianoche: true, especialCortaAMedianoche: true,
  retencionBase: 0.089753, retencionGuardias: 0.032609, retribuciones: null,
};
const guardias = {
  "2026-07-08": g(17, "15:00"), "2026-07-10": g(18, "15:00"), "2026-07-18": g(24, "09:00"),
  "2026-08-02": g(23, "09:00"), "2026-08-05": g(17, "15:00"), "2026-08-11": g(17, "15:00"),
};
// A: cuenta con todo al dia (nominas con desglose). B: cuenta guardada por
// una version antigua de la app (sin desglose), mas vieja y con una guardia
// que A no tiene.
const A = {
  version: 6, actualizadoEn: 2000, config: { ...config }, guardias, festivos: {},
  nominas: [fixture("complementaria-2026-07"), fixture("complementaria-2026-08"), fixture("normal-2026-09")],
};
const B = {
  version: 6, actualizadoEn: 1000, config: { ...config },
  guardias: { ...guardias, "2026-09-15": { horas: 17, inicio: "15:00", lugar: "", hecha: false } }, festivos: {},
  nominas: [{ periodo: "2026-07", clase: "guardias", bruto: 1349.16, neto: 1279.18, cotizacion: 69.98, irpf: 0 }],
};
writeFileSync(join(aqui, "estados.json"), JSON.stringify({ clave: CLAVE, A, B }));
console.log(`banco listo (clave ${CLAVE}). Abre http://localhost:8770/`);
