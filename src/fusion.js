// src/fusion.js
//
// Sincronizar sin perder nada. Antes la regla era "gana la copia entera mas
// reciente", y eso pierde datos en cuanto dos dispositivos cambian cosas
// distintas: el movil que se quedo abierto con datos de ayer sube una guardia
// y borra de la nube las nominas que se subieron hoy desde el ordenador; o un
// movil nuevo, recien puesta la fecha de inicio, pisa la nube entera con una
// copia casi vacia por tener la marca de tiempo mas alta.
//
// Aqui se fusiona dato a dato (cada guardia, cada festivo, cada nomina, cada
// ajuste) comparando tres copias: la `base` (lo ultimo que este dispositivo
// supo que habia en la nube de esa cuenta), la local y la remota. Lo que solo
// ha cambiado en un lado, se respeta; lo que no ha cambiado nadie, se queda;
// y solo si el MISMO dato ha cambiado en los dos lados de forma distinta
// manda la copia mas reciente. Sin base (primera vez en este dispositivo) se
// parte de cero: todo se suma y nada se borra.
import { estadoInicial } from "./estado.js";

const canonico = (x) => (Array.isArray(x) ? x.map(canonico)
  : x && typeof x === "object"
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonico(x[k])]))
    : x);

// Texto comparable de un valor, sin depender del orden de sus claves (dos
// dispositivos pueden guardar lo mismo en distinto orden). Lo ausente es "".
const huella = (x) => (x === undefined ? "" : JSON.stringify(canonico(x)));

const esObjeto = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);

function nominasPorClave(lista) {
  const mapa = {};
  for (const n of Array.isArray(lista) ? lista : []) {
    if (esObjeto(n)) mapa[`${n.periodo}|${n.clase}`] = n;
  }
  return mapa;
}

// Solo los datos del usuario: sin el tema (es de cada dispositivo) ni la
// marca de tiempo, y con las nominas por periodo y clase en vez de en lista.
function datosDe(e) {
  const { tema, ...config } = (e && esObjeto(e.config) && e.config) || {};
  return {
    config,
    guardias: (e && esObjeto(e.guardias) && e.guardias) || {},
    festivos: (e && esObjeto(e.festivos) && e.festivos) || {},
    nominas: nominasPorClave(e && e.nominas),
  };
}

export function mismosDatos(a, b) {
  return huella(datosDe(a)) === huella(datosDe(b));
}

// Una copia recien estrenada (sin fecha de inicio ni nada apuntado) no tiene
// nada que merezca subirse a una nube vacia.
export function tieneContenido(e) {
  const d = datosDe(e);
  return Boolean(d.config.inicioResidencia)
    || [d.guardias, d.festivos, d.nominas].some((m) => Object.keys(m).length > 0);
}

function fusionarMapa(b, l, r, ganaLocal, cuenta) {
  const res = {};
  // Primero las claves locales: asi las nominas conservan el orden en que
  // las ve este dispositivo y las que llegan de fuera van al final.
  for (const k of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b)])) {
    const hb = huella(b[k]);
    const hl = huella(l[k]);
    const hr = huella(r[k]);
    let v;
    if (hl === hr || hr === hb) v = l[k];       // iguales, o solo ha cambiado el local
    else if (hl === hb) v = r[k];               // solo ha cambiado el remoto
    else {
      // Cambiado en los dos lados de forma distinta: manda la copia mas
      // reciente, salvo que lo suyo sea haberlo borrado; antes que perder un
      // dato que el otro lado ha tocado, se conserva.
      const preferido = ganaLocal ? l[k] : r[k];
      v = preferido !== undefined ? preferido : (ganaLocal ? r[k] : l[k]);
      if (huella(v) !== hl) cuenta.perdidasLocales += 1;
    }
    if (v !== undefined) res[k] = v;
  }
  return res;
}

// Devuelve { estado, perdidasLocales }: el estado fusionado (sin tema ni
// marca de tiempo, que pone quien llama) y cuantos datos cambiados en este
// dispositivo han cedido ante un cambio mas reciente de otro.
export function fusionarEstados(base, local, remoto) {
  const b = base ? datosDe(base) : { ...datosDe(estadoInicial()), guardias: {}, festivos: {}, nominas: {} };
  const l = datosDe(local);
  const r = datosDe(remoto);
  const ganaLocal = ((local && local.actualizadoEn) || 0) >= ((remoto && remoto.actualizadoEn) || 0);
  const cuenta = { perdidasLocales: 0 };
  const estado = {
    version: 6,
    config: fusionarMapa(b.config, l.config, r.config, ganaLocal, cuenta),
    guardias: fusionarMapa(b.guardias, l.guardias, r.guardias, ganaLocal, cuenta),
    festivos: fusionarMapa(b.festivos, l.festivos, r.festivos, ganaLocal, cuenta),
    nominas: Object.values(fusionarMapa(b.nominas, l.nominas, r.nominas, ganaLocal, cuenta)),
  };
  return { estado, perdidasLocales: cuenta.perdidasLocales };
}

// Que hay que hacer al comparar la copia local con la de la nube:
//   "nada"     ya dicen lo mismo
//   "subir"    la nube va por detras: se sube la local tal cual
//   "adoptar"  el local va por detras: pasa a ser `estado` (no hay que subir)
//   "fusionar" las dos tenian cambios: `estado` es la mezcla, y hay que subirla
// `remoto` null es una cuenta sin nada en la nube.
//
// `copiaDeLaCuenta`: la copia local ya era de esta cuenta antes de existir la
// base (dispositivo que viene de una version anterior de la app). Si ademas la
// nube es mas reciente, lo normal es que este dispositivo simplemente lleve
// dias sin abrirse: se toma lo local como base, y asi lo que se borro desde
// otro dispositivo no reaparece al sumar las dos copias. Es lo que hacia la
// regla anterior ("gana la mas reciente") en ese mismo caso.
export function planSincronizacion({ base, local, remoto, ahora, copiaDeLaCuenta = false }) {
  if (!remoto) return { accion: tieneContenido(local) ? "subir" : "nada", perdidasLocales: 0 };
  if (!base && copiaDeLaCuenta && (remoto.actualizadoEn || 0) > ((local && local.actualizadoEn) || 0)) base = local;
  const f = fusionarEstados(base, local, remoto);
  const igualLocal = mismosDatos(f.estado, local);
  const igualRemoto = mismosDatos(f.estado, remoto);
  if (igualLocal && igualRemoto) return { accion: "nada", perdidasLocales: 0 };
  if (igualLocal) return { accion: "subir", perdidasLocales: 0 };
  if (igualRemoto) {
    return {
      accion: "adoptar",
      estado: { ...f.estado, actualizadoEn: remoto.actualizadoEn || 0 },
      perdidasLocales: f.perdidasLocales,
    };
  }
  return {
    accion: "fusionar",
    estado: { ...f.estado, actualizadoEn: ahora },
    perdidasLocales: f.perdidasLocales,
  };
}

// La base: lo ultimo que este dispositivo supo que habia en la nube de cada
// cuenta. Vive solo aqui (no viaja a la nube). Si no se puede leer o guardar
// (almacenamiento lleno o bloqueado), se sincroniza como la primera vez.
const claveBase = (clave, uid) => `${clave}_base_${uid}`;

export function leerBase(almacen, clave, uid) {
  try {
    const crudo = almacen.getItem(claveBase(clave, uid));
    const dato = crudo ? JSON.parse(crudo) : null;
    return esObjeto(dato) ? dato : null;
  } catch {
    return null;
  }
}

export function guardarBase(almacen, clave, uid, dato) {
  try {
    if (dato) almacen.setItem(claveBase(clave, uid), JSON.stringify(dato));
    else almacen.removeItem(claveBase(clave, uid));
  } catch { /* sin espacio: la proxima vez se fusiona sin base, que no pierde nada */ }
}
