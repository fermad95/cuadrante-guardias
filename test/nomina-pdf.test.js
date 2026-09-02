import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearNomina } from "../src/nomina-pdf.js";

// Texto real extraído de dos "Justificante de nómina" del SAS (agosto 2026):
// una Normal (sueldo base de agosto) y una Complementaria (guardias de
// julio, liquidadas en la nómina de agosto). Las cifras coinciden con las ya
// validadas contra nóminas reales en otras pruebas de este proyecto.
const TEXTO_NORMAL = `
Justificante de nómina
28/08/2026 09:01:24
DATOS DE LA EMPRESA
Centro de Nómina: D. Córdoba
DATOS DEL RECEPTOR
Nombre: Apellidos, Nombre
Categoría/puesto de desempeño: 27030 - - (M.I.R. 1º AÑO) Nivel: Nivel 00 Niv. Car. Pro.:
Tip.nóm.emisión: Normal Fecha emisión: 2026-08 Periodo liquidación: 01/08/2026 al 31/08/2026
Tip.nóm.afectación: Normal Fecha afectación: 2026-08 Días Nómina: 31 Porcentaje abono: 100,00 %
Clave Denominación conceptos Devengos Base Porcentaje Descuentos
001 SUELDO 1.379,90
002
003
011
COTIZACIÓN DESEMPLEO
FORMACIÓN PROFES.
COTIZAC.REG.GRAL.S.S
1.610,10
1.610,10
1.989,30
1,60
0,10
4,85
25,76
1,61
96,48
Total devengos: 1379,90 Total descuentos: 123,85
Líquido a percibir: 1256,05
`;

const TEXTO_COMPLEMENTARIA = `
Justificante de nómina
28/08/2026 09:01:46
DATOS DEL RECEPTOR
Nombre: Apellidos, Nombre
Tip.nóm.emisión: Complementaria Fecha emisión: 2026-08 Periodo liquidación: 01/07/2026 al 31/07/2026
Tip.nóm.afectación: Complementaria Fecha afectación: 2026-07 Días Nómina: Porcentaje abono: 100,00 %
Clave Denominación conceptos Devengos Base Porcentaje Descuentos
024
025
JORN.COMPLEMENTARIA
JORN.COMPLT.SB-DM-FE
844,20
504,96
002
003
011
COTIZACIÓN DESEMPLEO
FORMACIÓN PROFES.
COTIZAC.REG.GRAL.S.S
1.349,10
1.349,10
969,90
1,60
0,10
4,85
21,59
1,35
47,04
Total devengos: 1349,16 Total descuentos: 69,98
Líquido a percibir: 1279,18
`;

test("nomina Normal se parsea como base con el periodo del mes liquidado", () => {
  const n = parsearNomina(TEXTO_NORMAL);
  assert.deepEqual(n, {
    periodo: "2026-08", clase: "base",
    bruto: 1379.90, neto: 1256.05, cotizacion: 123.85, irpf: 0,
  });
});

test("nomina Complementaria se parsea como guardias, periodo del mes trabajado", () => {
  const n = parsearNomina(TEXTO_COMPLEMENTARIA);
  // Cifras confirmadas contra la nomina real de julio ya registrada en la app.
  assert.deepEqual(n, {
    periodo: "2026-07", clase: "guardias",
    bruto: 1349.16, neto: 1279.18, cotizacion: 69.98, irpf: 0,
  });
});

test("un periodo de liquidacion partido entre dos meses se rechaza", () => {
  const texto = TEXTO_NORMAL.replace(
    "Periodo liquidación: 01/08/2026 al 31/08/2026",
    "Periodo liquidación: 25/07/2026 al 24/08/2026");
  assert.throws(() => parsearNomina(texto), /no cae en un solo mes natural/);
});

test("un tipo de nomina desconocido se rechaza en vez de adivinar la clase", () => {
  const texto = TEXTO_NORMAL.replace("Tip.nóm.emisión: Normal", "Tip.nóm.emisión: Extraordinaria");
  assert.throws(() => parsearNomina(texto), /no reconocido/);
});

test("un PDF sin los totales esperados falla con un mensaje claro", () => {
  assert.throws(() => parsearNomina("texto que no es una nomina"), /No se encontró/);
});
