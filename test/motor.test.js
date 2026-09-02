import { test } from "node:test";
import assert from "node:assert/strict";
import { inicioSugerido, sugerenciaPara, partirGuardia, calcularGuardia } from "../src/motor.js";

const CONFIG = { inicioResidencia: "2026-05-27" };

test("el inicio sugerido sale de la duracion", () => {
  assert.equal(inicioSugerido(7), "15:00");
  assert.equal(inicioSugerido(12), "08:00");
  assert.equal(inicioSugerido(15), "17:00");
  assert.equal(inicioSugerido(17), "15:00");
  assert.equal(inicioSugerido(24), "08:00");
  assert.equal(inicioSugerido(9), "15:00"); // duracion desconocida
});

test("una guardia que no cruza medianoche da un solo tramo", () => {
  const tramos = partirGuardia(
    { fecha: "2026-06-08", horas: 7, inicio: "15:00" }, {}, {});
  assert.equal(tramos.length, 1);
  assert.deepEqual(tramos[0], {
    fecha: "2026-06-08", desde: "15:00", hasta: "22:00", horas: 7, tipo: "laborable",
  });
});

test("una guardia de 17h parte en la medianoche", () => {
  const tramos = partirGuardia(
    { fecha: "2026-08-07", horas: 17, inicio: "15:00" }, {}, {});
  assert.equal(tramos.length, 2);
  assert.deepEqual(tramos[0], {
    fecha: "2026-08-07", desde: "15:00", hasta: "24:00", horas: 9, tipo: "laborable",
  });
  assert.deepEqual(tramos[1], {
    fecha: "2026-08-08", desde: "00:00", hasta: "08:00", horas: 8, tipo: "sdf",
  });
});

test("una guardia de domingo pasa a laborable en la medianoche del lunes", () => {
  const tramos = partirGuardia(
    { fecha: "2026-08-02", horas: 15, inicio: "17:00" }, {}, {});
  assert.deepEqual(tramos.map((t) => [t.horas, t.tipo]), [[7, "sdf"], [8, "laborable"]]);
});

test("una guardia de 24h que empieza a las 08:00 no cruza dos medianoches", () => {
  const tramos = partirGuardia(
    { fecha: "2026-08-15", horas: 24, inicio: "08:00" }, {}, {});
  assert.equal(tramos.length, 2);
  assert.deepEqual(tramos.map((t) => [t.horas, t.tipo]), [[16, "sdf"], [8, "sdf"]]);
});

test("sin corte a medianoche la guardia entera va a la tarifa del dia de inicio", () => {
  const tramos = partirGuardia(
    { fecha: "2026-08-02", horas: 15, inicio: "17:00" },
    {}, { cortarAMedianoche: false });
  assert.equal(tramos.length, 1);
  assert.deepEqual(tramos[0], {
    fecha: "2026-08-02", desde: "17:00", hasta: "08:00 +1", horas: 15, tipo: "sdf",
  });
});

test("caso 1 del spec: 17h en miercoles, todo laborable", () => {
  const r = calcularGuardia(
    { fecha: "2026-08-05", horas: 17, inicio: "15:00" }, {}, CONFIG);
  assert.equal(r.horasPorTipo.laborable, 17);
  assert.equal(r.horasPorTipo.sdf, 0);
  assert.equal(r.bruto, 239.19);
});

test("caso 2 del spec: 17h en viernes cruza a sabado", () => {
  const r = calcularGuardia(
    { fecha: "2026-08-07", horas: 17, inicio: "15:00" }, {}, CONFIG);
  assert.deepEqual(r.importePorTipo, { laborable: 126.63, sdf: 126.24, especial: 0 });
  assert.equal(r.bruto, 252.87);
});

test("caso 3 del spec: 15h en domingo cruza a lunes", () => {
  const r = calcularGuardia(
    { fecha: "2026-08-02", horas: 15, inicio: "17:00" }, {}, CONFIG);
  assert.deepEqual(r.importePorTipo, { laborable: 112.56, sdf: 110.46, especial: 0 });
  assert.equal(r.bruto, 223.02);
});

test("caso 4 del spec: 24h en festivo especial cruza a laborable", () => {
  const festivos = { "2026-09-08": { nombre: "Fuensanta", clase: "especial" } };
  const r = calcularGuardia(
    { fecha: "2026-09-08", horas: 24, inicio: "08:00" }, festivos, CONFIG);
  assert.deepEqual(r.importePorTipo, { laborable: 112.56, sdf: 0, especial: 450.24 });
  assert.equal(r.bruto, 562.80);
});

test("caso 5 del spec: con el corte de especiales desactivado son 24h especiales", () => {
  const festivos = { "2026-09-08": { nombre: "Fuensanta", clase: "especial" } };
  const r = calcularGuardia(
    { fecha: "2026-09-08", horas: 24, inicio: "08:00" },
    festivos, { ...CONFIG, especialCortaAMedianoche: false });
  assert.equal(r.horasPorTipo.especial, 24);
  assert.equal(r.bruto, 675.36);
});

test("el corte de especiales desactivado no afecta a una guardia normal", () => {
  const r = calcularGuardia(
    { fecha: "2026-08-02", horas: 15, inicio: "17:00" },
    {}, { ...CONFIG, especialCortaAMedianoche: false });
  assert.equal(r.bruto, 223.02);
});

test("caso 6 del spec: sin lugar y sin marcar computa igual", () => {
  const a = calcularGuardia(
    { fecha: "2026-08-05", horas: 17, inicio: "15:00" }, {}, CONFIG);
  const b = calcularGuardia(
    { fecha: "2026-08-05", horas: 17, inicio: "15:00", lugar: "OBS", hecha: true },
    {}, CONFIG);
  assert.equal(a.bruto, b.bruto);
});

test("las tarifas siguen al anio de residencia", () => {
  const r = calcularGuardia(
    { fecha: "2027-06-10", horas: 17, inicio: "15:00" }, {}, CONFIG);
  assert.equal(r.bruto, 262.14); // 17 x 15.42, R2
});

test("la sugerencia sale del dia: entrada segun hoy, salida segun manana", () => {
  // 2026-08-03 lunes, 04 martes, 05 miercoles, 06 jueves
  for (const fecha of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]) {
    assert.deepEqual(sugerenciaPara(fecha, {}), { horas: 17, inicio: "15:00" }, fecha);
  }
  assert.deepEqual(sugerenciaPara("2026-08-07", {}), { horas: 18, inicio: "15:00" }); // viernes
  assert.deepEqual(sugerenciaPara("2026-08-08", {}), { horas: 24, inicio: "09:00" }); // sabado
  assert.deepEqual(sugerenciaPara("2026-08-09", {}), { horas: 23, inicio: "09:00" }); // domingo
});

test("un festivo entre semana se comporta como fin de semana", () => {
  // 2026-01-01 es jueves y festivo derivado; el viernes 2 es laborable
  assert.deepEqual(sugerenciaPara("2026-01-01", {}), { horas: 23, inicio: "09:00" });
});

test("la vispera de un festivo alarga la guardia hasta las 09:00", () => {
  // 2026-04-01 miercoles laborable; el 2 es Jueves Santo
  assert.deepEqual(sugerenciaPara("2026-04-01", {}), { horas: 18, inicio: "15:00" });
});

test("dos festivos seguidos dan una guardia de 24h", () => {
  // 2026-04-02 Jueves Santo y 2026-04-03 Viernes Santo
  assert.deepEqual(sugerenciaPara("2026-04-02", {}), { horas: 24, inicio: "09:00" });
});
