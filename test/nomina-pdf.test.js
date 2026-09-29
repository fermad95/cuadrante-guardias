import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsearNomina } from "../src/nomina-pdf.js";

// Texto real de cuatro "Justificante de nómina" del SAS, tal como lo saca
// pdf.js (una celda por línea, igual que extraerTextoPdf). Se ha quitado todo
// lo anterior a "Tip.nóm.emisión:" (nombre, NIF, NAF, IBAN): el repo es público.
const fixture = (nombre) => readFileSync(new URL(`./fixtures/${nombre}.txt`, import.meta.url), "utf8");
const NORMAL_AGO = fixture("normal-2026-08");
const NORMAL_SEP = fixture("normal-2026-09");
const COMPL_JUL = fixture("complementaria-2026-07");
const COMPL_AGO = fixture("complementaria-2026-08");

test("Normal de agosto: base, sin IRPF, cifras ya validadas", () => {
  const { nomina, avisos } = parsearNomina(NORMAL_AGO);
  assert.deepEqual(avisos, []);
  assert.deepEqual(nomina, {
    periodo: "2026-08", clase: "base",
    bruto: 1379.90, neto: 1256.05, cotizacion: 123.85, irpf: 0,
    desglose: { liquidacion: { desde: "2026-08-01", hasta: "2026-08-31" } },
  });
});

test("Normal de septiembre: primera con IRPF, se separa de la cotización", () => {
  const { nomina } = parsearNomina(NORMAL_SEP);
  assert.equal(nomina.periodo, "2026-09");
  assert.equal(nomina.irpf, 73.27);
  assert.equal(nomina.cotizacion, 123.85);
  assert.equal(nomina.neto, 1182.78);
});

test("Complementaria de julio: 60h laborables y 32h festivas, sacadas del PDF", () => {
  const { nomina } = parsearNomina(COMPL_JUL);
  assert.equal(nomina.periodo, "2026-07");
  assert.equal(nomina.clase, "guardias");
  assert.deepEqual(nomina.desglose.horas, { laborable: 60, sdf: 32, especial: 0 });
  assert.equal(nomina.desglose.guardias, 1349.16);
  assert.equal(nomina.desglose.prorrataVacaciones, undefined);
});

test("Complementaria de agosto: guardias reales aparte de la prorrata de vacaciones", () => {
  const { nomina, avisos } = parsearNomina(COMPL_AGO);
  assert.deepEqual(avisos, []);
  assert.deepEqual(nomina, {
    periodo: "2026-08", clase: "guardias",
    bruto: 1681.91, neto: 1500.83, cotizacion: 91.77, irpf: 89.31,
    desglose: {
      liquidacion: { desde: "2026-08-01", hasta: "2026-08-31" },
      horas: { laborable: 59, sdf: 16, especial: 0 },
      guardias: 1082.61,
      prorrataVacaciones: 599.30,
      diasVacaciones: 15,
    },
  });
});

test("un periodo partido entre dos meses ya no se rechaza: se imputa a la fecha de afectación y se avisa", () => {
  const texto = NORMAL_AGO.replace("01/08/2026 al 31/08/2026", "25/07/2026 al 24/08/2026");
  const { nomina, avisos } = parsearNomina(texto);
  assert.equal(nomina.periodo, "2026-08");
  assert.match(avisos.join(" "), /más de un mes/);
});

test("un tipo de nómina desconocido se deduce por sus conceptos y se avisa", () => {
  const texto = COMPL_AGO.replace("Tip.nóm.emisión:\n \nComplementaria", "Tip.nóm.emisión:\n \nAtrasos");
  const { nomina, avisos } = parsearNomina(texto);
  assert.equal(nomina.clase, "guardias");
  assert.match(avisos.join(" "), /Atrasos/);
});

test("un concepto desconocido queda en 'otros', cuenta en el bruto y no como guardia", () => {
  const texto = NORMAL_AGO
    .replace("001\n \nSUELDO\n \n1.379,90", "001\n \nSUELDO\n \n1.379,90\n\n777\n\nATRASOS VARIOS\n\n20,00")
    .replace("Total devengos: 1379,90", "Total devengos: 1399,90");
  const { nomina, avisos } = parsearNomina(texto);
  assert.deepEqual(nomina.desglose.otros, [{ nombre: "ATRASOS VARIOS", importe: 20 }]);
  assert.match(avisos.join(" "), /ATRASOS VARIOS/);
});

test("si la tabla no cuadra con los totales, se guardan solo los totales y se avisa", () => {
  const texto = COMPL_AGO.replace("Total devengos: 1681,91", "Total devengos: 1700,00");
  const { nomina, avisos } = parsearNomina(texto);
  assert.equal(nomina.desglose, undefined);
  assert.equal(nomina.cotizacion, 181.08);
  assert.equal(nomina.irpf, 0);
  assert.match(avisos.join(" "), /No he podido leer/);
});

test("un PDF sin los totales esperados falla con un mensaje claro", () => {
  assert.throws(() => parsearNomina("texto que no es una nomina"), /No se encontró/);
});
