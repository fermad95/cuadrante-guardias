// src/cuenta.js
//
// De que cuenta de Google es la copia guardada en este dispositivo. Sin esto,
// al cerrar sesion y entrar con otra cuenta en el mismo movil, la regla de
// "gana la copia mas reciente" podia quedarse con los datos locales (de la
// cuenta anterior) y subirlos a la nube de la cuenta nueva, mezclando los
// datos de dos personas. Ahora:
//   - la copia local recuerda el uid de su cuenta;
//   - al entrar con una cuenta distinta se cargan siempre los datos de esa
//     cuenta (su nube, o su respaldo local si es mas reciente), nunca los de
//     la anterior, que quedan como respaldo de su propia cuenta;
//   - el guardado en la nube no escribe si la sesion no es la duena (ui.js).
// Las claves derivan de CLAVE, asi que cada copia de la app tiene las suyas.
import { CLAVE, estadoInicial, importarEstado } from "./estado.js";
import { esMasReciente } from "./persistencia.js";

export const CLAVE_CUENTA = `${CLAVE}_cuenta`;
const claveRespaldo = (uid) => `${CLAVE}_respaldo_${uid}`;

export function leerCuenta(almacen) {
  try { return almacen.getItem(CLAVE_CUENTA) || null; } catch { return null; }
}

export function fijarCuenta(almacen, uid) {
  try { almacen.setItem(CLAVE_CUENTA, uid); } catch { /* sin espacio: se reintenta la proxima vez */ }
}

export function guardarRespaldoCuenta(almacen, uid, dato) {
  if (!uid) return;
  try { almacen.setItem(claveRespaldo(uid), JSON.stringify(dato)); } catch { /* sin espacio */ }
}

export function leerRespaldoCuenta(almacen, uid) {
  try {
    const crudo = almacen.getItem(claveRespaldo(uid));
    const dato = crudo ? JSON.parse(crudo) : null;
    return dato && typeof dato === "object" ? dato : null;
  } catch {
    return null;
  }
}

// Decide que hacer al conocer la cuenta de la sesion. Pura, para poder
// probarla sin navegador.
//   duenoLocal: uid de la cuenta de la copia local (null si nunca se supo:
//               app usada sin sesion o de antes de esta version)
//   uid:        cuenta de la sesion actual
//   remoto:     lo que hay en la nube de esa cuenta (null si no hay nada)
//   respaldo:   copia local que se guardo de esa cuenta al salir de ella
// Devuelve { tipo: "misma" } si la copia local es de esta cuenta (o de nadie:
// entonces se sigue la regla de siempre y la primera sesion sube lo local),
// o { tipo: "otra", estado, subir } con los datos de la cuenta nueva.
export function decidirCuenta({ duenoLocal, uid, remoto, respaldo }) {
  if (!duenoLocal || duenoLocal === uid) return { tipo: "misma" };
  let elegido = remoto || respaldo || null;
  let subir = false;
  if (remoto && respaldo && esMasReciente(respaldo, remoto)) {
    // Cambios de esa cuenta hechos en este movil que no llegaron a subirse.
    elegido = respaldo;
    subir = true;
  } else if (!remoto && respaldo) {
    subir = true;
  }
  if (!elegido) return { tipo: "otra", estado: estadoInicial(), subir: false };
  const r = importarEstado(JSON.stringify(elegido));
  if (!r.ok) return { tipo: "otra", estado: estadoInicial(), subir: false };
  return { tipo: "otra", estado: { ...r.estado, actualizadoEn: elegido.actualizadoEn || 0 }, subir };
}
