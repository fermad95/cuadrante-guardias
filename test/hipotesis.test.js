import { test } from "node:test";
import assert from "node:assert/strict";
import { compararHipotesis } from "../src/nomina.js";

// Fixture propio, no el estado inicial: estas cifras son las validadas contra las
// nominas reales de junio y agosto de 2026 y tienen que seguir saliendo iguales
// aunque el arranque de la app pase a estar vacio.
function estadoDePrueba() {
  return {
    config: {
      inicioResidencia: "2026-05-27",
      cortarAMedianoche: true,
      especialCortaAMedianoche: true,
      retencionBase: 0.089753,
      retencionGuardias: 0.032609,
      retribuciones: null,
    },
    festivos: {},
    nominas: [],
    guardias: {
      "2026-06-08": { horas: 7, inicio: "15:00", lugar: "", hecha: true },
      "2026-06-15": { horas: 7, inicio: "15:00", lugar: "", hecha: true },
      "2026-06-20": { horas: 12, inicio: "08:00", lugar: "", hecha: true },
      "2026-06-26": { horas: 7, inicio: "15:00", lugar: "", hecha: true },
      "2026-08-02": { horas: 15, inicio: "17:00", lugar: "", hecha: true },
      "2026-08-03": { horas: 8, inicio: "08:00", lugar: "", hecha: true },
      "2026-08-05": { horas: 17, inicio: "15:00", lugar: "OBS", hecha: true },
      "2026-08-11": { horas: 17, inicio: "15:00", lugar: "", hecha: true },
      "2026-08-13": { horas: 17, inicio: "15:00", lugar: "", hecha: true },
    },
  };
}

const ESTADO = estadoDePrueba();

test("junio no distingue las hipotesis: ninguna guardia cruza de tarifa", () => {
  const c = compararHipotesis("2026-06", ESTADO);
  assert.equal(c.difieren, false);
  assert.equal(c.diferencia, 0);
  assert.equal(c.conCorte.brutoGuardias, 484.83);
  assert.equal(c.sinCorte.brutoGuardias, 484.83);
});

test("agosto si las distingue", () => {
  const c = compararHipotesis("2026-08", ESTADO);
  assert.equal(c.difieren, true);
  assert.equal(c.conCorte.brutoGuardias, 1053.15);
  assert.equal(c.sinCorte.brutoGuardias, 1066.83);
  assert.equal(c.diferencia, 13.68);
  assert.deepEqual(c.conCorte.horasPorTipo, { laborable: 67, sdf: 7, especial: 0 });
  assert.deepEqual(c.sinCorte.horasPorTipo, { laborable: 59, sdf: 15, especial: 0 });
});

test("comparar no altera la configuracion del estado", () => {
  const estado = estadoDePrueba();
  compararHipotesis("2026-08", estado);
  assert.equal(estado.config.cortarAMedianoche, true);
});

test("un mes sin guardias no difiere", () => {
  assert.equal(compararHipotesis("2026-07", ESTADO).difieren, false);
});
