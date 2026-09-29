// src/tarifas.js
import { redondear } from "./fechas.js";

export const RETRIBUCIONES_ANEXO = {
  guardias: {
    1: { laborable: 14.07, sdf: 15.78, especial: 28.14 },
    2: { laborable: 15.42, sdf: 17.28, especial: 30.84 },
    3: { laborable: 18.02, sdf: 20.17, especial: 36.04 },
    4: { laborable: 20.22, sdf: 22.61, especial: 40.44 },
    5: { laborable: 20.22, sdf: 22.61, especial: 40.44 },
  },
  sueldoBase: 1379.90,
  cgFormacion: { 1: 0, 2: 110.38, 3: 248.41, 4: 386.37, 5: 524.38 },
};

export const PAGAS = 14;

export function retribucionesDe(config) {
  return (config && config.retribuciones) || RETRIBUCIONES_ANEXO;
}

export function anioResidenciaEn(fechaISO, inicioResidencia) {
  if (!inicioResidencia) return 1;
  const [ai, mi, di] = inicioResidencia.split("-").map(Number);
  const [af, mf, df] = fechaISO.split("-").map(Number);
  let anios = af - ai;
  if (mf < mi || (mf === mi && df < di)) anios -= 1;
  return Math.min(5, Math.max(1, anios + 1));
}

// `config.preciosNomina` (lo pone nomina.js, no se guarda) trae, por mes, los
// precios por hora que pago el SAS segun la complementaria de ese mes: si
// existen y son del mismo anio de residencia, mandan sobre la tabla. Asi los
// meses ya liquidados se calculan con lo que se pago de verdad aunque el
// convenio cambie, y las previsiones siguen con la tabla (anexo o Ajustes).
export function tarifaEn(fechaISO, config) {
  const anio = anioResidenciaEn(fechaISO, config.inicioResidencia);
  const tabla = retribucionesDe(config).guardias[anio];
  const delMes = config.preciosNomina && config.preciosNomina[fechaISO.slice(0, 7)];
  return delMes && delMes.anio === anio ? { ...tabla, ...delMes.precios } : tabla;
}

export function retribucionFija(anioResidencia, config) {
  const r = retribucionesDe(config);
  const sueldo = r.sueldoBase;
  const cg = r.cgFormacion[anioResidencia];
  const mensual = redondear(sueldo + cg);
  return { sueldo, cg, mensual, anual: redondear(mensual * PAGAS) };
}
