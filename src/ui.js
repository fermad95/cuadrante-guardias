// src/ui.js
import { diasDelMes, diaSemana, redondear } from "./fechas.js";
import { sugerenciaPara, calcularGuardia } from "./motor.js";
import { resumenMes, resumenAnio, tiposEfectivos, historialTipos, ingresoDelMes, contrasteGuardias, nominaDe, diferenciasConSAS, configConPrecios, tarifasDesfasadas, csvAnual } from "./nomina.js";
import { extraerTextoPdf, parsearNomina } from "./nomina-pdf.js";
import { CLAVE, cargar, guardar, estadoInicial, importarEstado, mismaData, guardarPrevio, cargarPrevio } from "./estado.js";
import { planSincronizacion, leerBase, guardarBase } from "./fusion.js";
import { cargarRemoto, creaGuardadoRemoto, esMasReciente } from "./persistencia.js";
import { alCambiarSesion, iniciarSesion, cerrarSesion, leerNube, escribirNube, creaSincronizador } from "./nube.js";
import { leerCuenta, fijarCuenta, guardarRespaldoCuenta, leerRespaldoCuenta, decidirCuenta } from "./cuenta.js";
import { RETRIBUCIONES_ANEXO, retribucionesDe } from "./tarifas.js";
import { calendarioDe } from "./festivos.js";
import { LOGO_URI } from "./logo.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// La clave es interna (sin tildes, se usa como estado); el texto es lo que se lee.
const PESTANAS = [
  { clave: "calendario", texto: "Calendario" },
  { clave: "festivos", texto: "Festivos" },
  { clave: "nominas", texto: "Nóminas" },
  { clave: "anual", texto: "Anual" },
];
const DURACIONES = [7, 8, 12, 15, 17, 18, 23, 24];
const LUGARES = [
  { sigla: "URG", nombre: "Puerta de Urgencias" },
  { sigla: "OBS", nombre: "Observación" },
  { sigla: "PT", nombre: "Puerta de Trauma" },
  { sigla: "DSS", nombre: "Deccu Sector Sur" },
  { sigla: "DCP", nombre: "Deccu Castilla del Pino" },
];
const HORAS_TIPO = { laborable: "laborables", sdf: "festivas", especial: "de festivo especial" };

// Los lugares de guardia de cada hospital: por defecto los de arriba, y cada
// usuario puede poner los suyos en Ajustes (config.lugares). Las guardias
// guardan solo la sigla, asi que quitar un lugar de la lista no las toca.
function lugaresDe(config) {
  const l = config && config.lugares;
  return Array.isArray(l) && l.every((x) => x && typeof x.sigla === "string" && typeof x.nombre === "string")
    ? l : LUGARES;
}

const textoLugares = (lista) => lista.map((l) => `${l.sigla} ${l.nombre}`).join("\n");

function leerLugares(texto) {
  return texto.split("\n").map((linea) => linea.trim()).filter(Boolean).map((linea) => {
    const [sigla, ...resto] = linea.split(/\s+/);
    return { sigla: sigla.slice(0, 8), nombre: resto.join(" ") || sigla };
  });
}

const eur = (n) => `${n.toFixed(2).replace(".", ",")} €`;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GUION = {
  episodio: "Episodio IV",
  titulo: "UNA NUEVA NÓMINA",
  parrafos: [
    "Es una época de incertidumbre. Un joven RESIDENTE ha comenzado su formación "
    + "en un hospital de la periferia, sin saber aún cuánto va a cobrar por las "
    + "guardias que le esperan.",
    "Mientras el ANEXO XVI fija el valor de cada hora, nadie ha sabido decirle si "
    + "el SAS parte las guardias a medianoche o las paga enteras a la tarifa del "
    + "día en que empiezan. Trece euros con sesenta y ocho céntimos penden de esa "
    + "respuesta.",
    "Perseguido por la duda, el residente ha construido este CUADRANTE para "
    + "calcular su destino antes de que llegue la nómina....",
  ],
};

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function iniciar(raiz, almacen) {
  const estado = cargar(almacen);
  let pestana = "calendario";
  let mesVisible = hoyISO().slice(0, 7);
  let ajustesAbierto = false;
  // PDFs de nomina leidos en esta sesion, pendientes de revisar y confirmar
  // uno a uno; no se persisten hasta que el usuario pulsa "Anadir".
  let pendientesNomina = [];
  let estadoPdf = "";
  // Ultima nomina borrada, para poder deshacerlo durante unos segundos.
  let deshacer = null; // { nomina, indice, temporizador } | null

  raiz.querySelector("#logo-app").src = LOGO_URI;

  let sesion = null; // { uid, nombre, correo, foto } | null

  // Repinta Ajustes cuando cambia el estado del guardado en la nube, pero
  // solo si esta abierto: no tiene sentido tocar la pantalla si el usuario
  // esta en el calendario. Dos canales independientes: el Artifact de Claude
  // (si la app vive ahi) y Firebase (si hay sesion de Google) — cualquiera
  // de los dos, o ninguno, puede estar disponible segun donde se abra la app.
  const repintarAjustesSiAbierto = () => { if (ajustesAbierto) abrirAjustes(); };
  // El estado del guardado cambia a menudo (cada cambio pasa por "guardando"):
  // solo se actualiza su linea, sin repintar Ajustes entero, que borraria lo
  // que se este escribiendo en sus campos.
  const pintarEstadoGuardado = () => {
    const el = raiz.querySelector("#a-estado-nube");
    if (ajustesAbierto && el) el.textContent = textoEstadoGuardado();
  };
  const guardarRemoto = creaGuardadoRemoto(pintarEstadoGuardado);
  const sinc = creaSincronizador(() => sincronizar(), pintarEstadoGuardado);
  // Guardar en este dispositivo puede fallar (almacenamiento lleno o
  // bloqueado): no por eso se deja de intentar la copia en la nube.
  const guardarLocal = () => {
    try { guardar(almacen, estado); } catch { /* sigue en memoria y en la nube */ }
  };
  const persistir = () => {
    estado.actualizadoEn = Date.now();
    guardarLocal();
    guardarRemoto(estado);
    sinc.programar();
  };

  // Cambia el contenido del estado sin cambiar los objetos `estado` ni
  // `estado.config`: hay pantallas abiertas (Ajustes) que guardan referencia
  // a ellos y escribirian en un objeto huerfano. El tema es de cada
  // dispositivo y se conserva.
  function reemplazarEstado(nuevo) {
    const tema = estado.config.tema;
    const config = estado.config;
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, nuevo.config, { tema });
    for (const k of Object.keys(estado)) if (k !== "config") delete estado[k];
    Object.assign(estado, { ...nuevo, config });
    // Una nomina abierta para editar apuntaba a un objeto que ya no existe.
    pendientesNomina = pendientesNomina.filter((p) => !p.editando);
  }

  // Para lo que llega del Artifact de Claude (si la app vive ahi): solo se
  // adopta si es mas reciente que lo local, y pasa por la misma validacion
  // que la copia de seguridad pegada a mano. La nube de Google va por
  // `sincronizar`, que fusiona dato a dato.
  function adoptarRemoto(remoto) {
    if (!remoto || !esMasReciente(remoto, estado)) return;
    const resultado = importarEstado(JSON.stringify(remoto));
    if (!resultado.ok) return;
    const tema = estado.config.tema;
    // Antes de pisar lo local, se mira si la copia remota descarta ediciones
    // de este dispositivo: si es asi, la anterior queda guardada y se avisa.
    const previo = { ...estado };
    const habiaEdiciones = !mismaData(previo, resultado.estado);
    Object.assign(estado, resultado.estado);
    estado.config.tema = tema;
    estado.actualizadoEn = remoto.actualizadoEn || Date.now();
    guardar(almacen, estado);
    pintar();
    if (habiaEdiciones) {
      guardarPrevio(almacen, previo);
      avisarAdopcion();
    }
  }

  // Sincroniza con la nube de la cuenta de la sesion: lee lo que hay, lo
  // fusiona dato a dato con lo local (fusion.js) y sube el resultado si hace
  // falta. Se llama al conocer la sesion, tras cada cambio (con pausa), al
  // volver a primer plano y al recuperar la conexion. Devuelve "al-dia" o
  // "no-disponible".
  //
  // Si la copia local es de OTRA cuenta, antes se cargan los datos de la
  // cuenta nueva y los locales quedan como respaldo de la suya: nunca se
  // suben a la nube de quien no es.
  let avisadaCuentaSinCargar = null;
  async function sincronizar() {
    if (!sesion) return "no-disponible";
    const uid = sesion.uid;
    const lectura = await leerNube();
    if (!sesion || sesion.uid !== uid) return "no-disponible"; // la sesion cambio mientras tanto
    const dueno = leerCuenta(almacen);
    if (!lectura.ok || lectura.uid !== uid) {
      if (dueno && dueno !== uid && avisadaCuentaSinCargar !== uid) {
        avisadaCuentaSinCargar = uid;
        avisar("No se han podido cargar los datos de esta cuenta (¿sin conexión?). "
          + "No se sincroniza nada hasta que vuelva la conexión.");
      }
      return "no-disponible";
    }
    // Lo remoto pasa por la misma validacion que una copia pegada a mano. Un
    // documento que no es una copia del cuadrante cuenta como nube vacia.
    let remoto = null;
    if (lectura.dato) {
      const r = importarEstado(JSON.stringify(lectura.dato));
      if (r.ok) remoto = { ...r.estado, actualizadoEn: Number(lectura.dato.actualizadoEn) || 0 };
    }

    if (dueno && dueno !== uid) {
      const d = decidirCuenta({
        duenoLocal: dueno, uid, remoto: lectura.dato, respaldo: leerRespaldoCuenta(almacen, uid),
      });
      guardarRespaldoCuenta(almacen, dueno, estado);
      reemplazarEstado(d.estado);
      fijarCuenta(almacen, uid);
      guardarLocal();
      pintar();
      if (ajustesAbierto) abrirAjustes();
      avisar("Has entrado con otra cuenta de Google: se muestran sus datos. "
        + "Los de la cuenta anterior siguen en su nube y en este dispositivo, sin mezclarse.");
      if (!d.subir) {
        guardarBase(almacen, CLAVE, uid, remoto);
        return "al-dia";
      }
      // Habia cambios de esta cuenta sin subir (su respaldo): siguen abajo.
    } else {
      fijarCuenta(almacen, uid);
    }

    const plan = planSincronizacion({
      base: leerBase(almacen, CLAVE, uid), local: estado, remoto, ahora: Date.now(),
      copiaDeLaCuenta: dueno === uid,
    });
    if (plan.accion === "adoptar" || plan.accion === "fusionar") {
      const previo = JSON.parse(JSON.stringify(estado));
      reemplazarEstado(plan.estado);
      guardarLocal();
      pintar();
      if (ajustesAbierto) abrirAjustes();
      // Solo si algun cambio de este dispositivo ha cedido ante uno mas
      // reciente de otro: la copia anterior queda guardada y se avisa.
      if (plan.perdidasLocales > 0) {
        guardarPrevio(almacen, previo);
        avisarAdopcion();
      }
    }
    if (plan.accion === "subir" || plan.accion === "fusionar") {
      // Las versiones anteriores de la app solo miran la marca de tiempo: lo
      // que se sube tiene que ser mas reciente que lo que habia.
      if (remoto && !(estado.actualizadoEn > remoto.actualizadoEn)) {
        estado.actualizadoEn = Date.now();
        guardarLocal();
      }
      const enviado = JSON.parse(JSON.stringify(estado));
      if (!(await escribirNube(uid, enviado))) return "no-disponible";
      guardarBase(almacen, CLAVE, uid, enviado);
    } else {
      guardarBase(almacen, CLAVE, uid, JSON.parse(JSON.stringify(estado)));
    }
    return "al-dia";
  }

  function avisar(texto) {
    const vista = raiz.querySelector("#vista");
    if (!vista) return;
    const nota = document.createElement("p");
    nota.className = "aviso";
    nota.textContent = texto;
    vista.prepend(nota);
  }

  // Aviso no bloqueante cuando una copia remota mas reciente pisa ediciones
  // locales: la copia anterior quedo guardada y se ofrece restaurarla. Al
  // restaurar, la copia local vuelve a ser la mas reciente y se sincroniza.
  function avisarAdopcion() {
    const vista = raiz.querySelector("#vista");
    const nota = document.createElement("p");
    nota.className = "aviso";
    nota.textContent = "Otro dispositivo había cambiado lo mismo más tarde y se ha quedado su versión. ";
    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "Restaurar mi copia anterior";
    boton.onclick = () => {
      const previo = cargarPrevio(almacen);
      if (!previo) return;
      const r = importarEstado(JSON.stringify(previo));
      if (!r.ok) return;
      const tema = estado.config.tema;
      Object.assign(estado, r.estado);
      estado.config.tema = tema;
      persistir(); // queda como la mas reciente: gana esta copia y se sincroniza
      pintar();
    };
    nota.appendChild(boton);
    vista.prepend(nota);
  }

  function pintar() {
    document.documentElement.dataset.tema = estado.config.tema || "sobrio";
    if (!estado.config.inicioResidencia) return pintarBienvenida();
    raiz.querySelector("#pestanas").hidden = false;
    raiz.querySelector("#pestanas").innerHTML = PESTANAS
      .map(({ clave, texto }) =>
        `<button data-pestana="${clave}" class="${clave === pestana ? "activo" : ""}">${texto}</button>`)
      .join("");
    const vista = raiz.querySelector("#vista");
    if (pestana === "calendario") vista.innerHTML = vistaCalendario();
    if (pestana === "festivos") vista.innerHTML = vistaFestivos();
    if (pestana === "nominas") vista.innerHTML = vistaNominas();
    if (pestana === "anual") vista.innerHTML = vistaAnual();
  }

  // La intro solo aparece en el primer arranque con el tema espacial, o cuando
  // se pide desde Ajustes. Siempre se puede saltar, y con reduccion de
  // movimiento activada se omite entera.
  function lanzarIntro(pedida = false) {
    const caja = raiz.querySelector("#intro");
    // La reduccion de movimiento del sistema significa "no me sueltes animaciones
    // sin avisar", no "no me dejes ver una que he pedido". Solo frena la
    // automatica del primer arranque.
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (sinMovimiento && !pedida) return;

    caja.innerHTML = `
      <button id="intro-saltar">Saltar ▸</button>
      <p class="intro-lejos">Hace mucho tiempo, en un hospital muy, muy lejano....</p>
      <div class="intro-logo">Cuadrante</div>
      <div class="intro-espacio">
        <div class="intro-crawl">
          <p class="intro-episodio">${GUION.episodio}</p>
          <h2 class="intro-titulo">${GUION.titulo}</h2>
          ${GUION.parrafos.map((p) => `<p>${p}</p>`).join("")}
        </div>
      </div>`;
    caja.hidden = false;
    document.body.classList.add("con-intro");

    const cerrar = () => {
      caja.hidden = true;
      caja.innerHTML = "";
      document.body.classList.remove("con-intro");
      clearTimeout(reloj);
      document.removeEventListener("keydown", porTecla);
    };
    const porTecla = (ev) => { if (ev.key === "Escape" || ev.key === " ") cerrar(); };
    const reloj = setTimeout(cerrar, 38000);
    caja.onclick = cerrar;
    document.addEventListener("keydown", porTecla);
  }

  function pintarBienvenida() {
    raiz.querySelector("#pestanas").hidden = true;
    raiz.querySelector("#vista").innerHTML = `
      <div class="tarjeta">
        <img class="logo-bienvenida" src="${LOGO_URI}" alt="">
        <strong class="etiqueta">Empecemos</strong>
        <div class="crawl"><p>Para calcular tus guardias necesito saber cuándo empezaste
           la residencia. De esa fecha salen tu año (R1 a R5) y las tarifas que te
           corresponden.</p></div>
        <p class="etiqueta-campo">Fecha de inicio</p>
        <input type="date" id="b-inicio" value="">
        <div class="acciones-modal">
          <button class="primario" id="b-empezar">Empezar</button>
        </div>
        <p class="aviso">Puedes cambiarla después en Ajustes.</p>
      </div>`;
  }

  function vistaCalendario() {
    const [anio, mes] = mesVisible.split("-").map(Number);
    const dias = diasDelMes(mesVisible);
    const hueco = (diaSemana(dias[0]) + 6) % 7; // lunes primero
    const celdas = ['<div aria-hidden="true"></div>'.repeat(hueco)];
    const hoy = hoyISO();
    for (const fecha of dias) {
      const g = estado.guardias[fecha];
      const num = Number(fecha.slice(8));
      let clases = "dia";
      if (fecha === hoy) clases += " hoy";
      let detalle = "";
      if (g) {
        const r = calcularGuardia({ ...g, fecha }, estado.festivos, configConPrecios(estado));
        const tipos = [...new Set(r.tramos.map((t) => t.tipo))];
        clases += ` ${tipos[0]}`;
        if (!g.hecha) clases += " prevista";
        detalle = `<span class="horas">${g.horas}h</span>`;
        if (g.lugar) detalle += `<span class="lugar">${esc(g.lugar)}</span>`;
        if (tipos.length > 1) detalle += `<span class="cruza">cruza</span>`;
      }
      celdas.push(`<button type="button" class="${clases}" data-fecha="${fecha}" aria-label="${fecha}"><span class="num">${num}</span>${detalle}</button>`);
    }
    const r = resumenMes(mesVisible, estado);
    const p = ingresoDelMes(mesVisible, estado);
    const contraste = contrasteGuardias(mesVisible, estado);
    const sinMarcar = Object.entries(estado.guardias)
      .filter(([f, g]) => f.slice(0, 7) === mesVisible && !g.hecha).length;

    // El tipo de las guardias se calibra con una nomina concreta, y parte de la
    // cotizacion esta topada: en un mes con bastantes mas guardias que aquella,
    // el descuento real es proporcionalmente menor y el neto sale corto.
    const refGuardias = historialTipos(estado.nominas, "guardias").slice(-1)[0];
    const prorrataDelMes = Number(estado.nominas.filter((n) => n.periodo === mesVisible && n.clase === "guardias")
      .slice(-1)[0]?.desglose?.prorrataVacaciones) || 0;
    const netoCorto = !r.netoGuardiasReal && refGuardias && r.brutoGuardias > refGuardias.bruto * 1.25;

    return `
      <div class="tarjeta">
        <div class="cabecera-mes">
          <button class="nav-mes" data-mes="-1">‹</button>
          <strong class="mes-titulo">${MESES[mes - 1]} <span class="mes-anio">${anio}</span></strong>
          <button class="nav-mes" data-mes="1">›</button>
        </div>
        <div class="rejilla" style="margin:.75rem 0">
          ${["L", "M", "X", "J", "V", "S", "D"].map((d) => `<div class="cabecera-semana">${d}</div>`).join("")}
        </div>
        <div class="rejilla">${celdas.join("")}</div>
        <p class="aviso">Las guardias con borde punteado aún no están marcadas como
          realizadas: cuentan como previsión.</p>
      </div>
      <div class="tarjeta">
        <strong class="etiqueta">Resumen de ${MESES[mes - 1]}</strong>
        <table>
          <tr><td>Sueldo base</td><td class="cifra">${eur(r.brutoBase)}</td></tr>
          ${r.pagaExtra > 0 ? `<tr><td>Paga extra <span class="tenue">(${r.netoBaseReal ? "incluida en la nómina real" : "previsión"})</span></td><td class="cifra">${eur(r.pagaExtra)}</td></tr>` : ""}
          ${filaTipo("laborable", r)}${filaTipo("sdf", r)}${filaTipo("especial", r)}
          <tr><td>Bruto total</td><td class="cifra">${eur(r.bruto)}</td></tr>
          <tr><td>Guardias confirmadas</td><td class="cifra">${eur(r.brutoConfirmado)}</td></tr>
          <tr><td>Guardias previstas</td><td class="cifra">${eur(r.brutoPrevisto)}</td></tr>
          <tr><td>Neto de la nómina base${r.netoBaseReal ? ` <span class="tenue">(nómina real)</span>` : ""}</td><td class="cifra">${eur(r.netoBase)}</td></tr>
          <tr><td>Neto de las guardias${r.netoGuardiasReal ? ` <span class="tenue">(nómina real)</span>` : ""}</td><td class="cifra">${eur(r.netoGuardias)}</td></tr>
          <tr><td class="total">Total neto</td><td class="cifra total">${eur(r.neto)}</td></tr>
        </table>
        ${r.netoGuardiasReal && prorrataDelMes > 0 ? `<p class="aviso">El neto de las guardias es el de
          tu nómina, e incluye ${eur(prorrataDelMes)} brutos de prorrata de vacaciones.</p>` : ""}
        ${netoCorto ? `<p class="aviso">El neto de las guardias se calcula con el tipo
          de tu nómina de ${esc(refGuardias.periodo)}, que liquidaba
          ${eur(refGuardias.bruto)}. Este mes son ${eur(r.brutoGuardias)}, y como parte
          de la cotización está topada, lo más probable es que cobres <strong>algo
          más</strong> de lo que pone aquí.</p>` : ""}
        ${sinMarcar > 0 ? `<div class="chips" style="margin-top:.9rem">
          <button id="marcar-mes">Marcar ${sinMarcar === 1
            ? "la guardia pendiente" : `las ${sinMarcar} guardias pendientes`} como realizada${sinMarcar === 1 ? "" : "s"}</button>
        </div>` : ""}
      </div>
      ${contraste ? vistaContraste(contraste) : ""}
      <div class="tarjeta">
        <strong class="etiqueta">Lo que ingresas este mes</strong>
        <table>
          <tr><td>Nómina base <span class="tenue">(${p.baseReal ? "nómina real" : "previsión"})</span></td><td class="cifra">${eur(p.base)}</td></tr>
          <tr><td>Guardias de ${p.guardiasDe} <span class="tenue">(${p.guardiasReal ? "nómina real" : "previsión"})</span></td><td class="cifra">${eur(p.importeGuardias)}</td></tr>
          <tr><td class="total">Total</td><td class="cifra total">${eur(p.total)}</td></tr>
        </table>
        <p class="aviso">Las guardias se cobran en la nómina del mes siguiente.${p.prorrataVacaciones > 0
          ? ` La de guardias incluye ${eur(p.prorrataVacaciones)} brutos de prorrata de vacaciones.` : ""}</p>
      </div>`;
  }

  // Lo que liquido el SAS frente a lo que sale del calendario. Las horas de
  // guardia se comparan tipo a tipo; la prorrata de vacaciones va aparte
  // porque no corresponde a ninguna guardia del calendario.
  function vistaContraste(c) {
    const filas = ["laborable", "sdf", "especial"]
      .filter((t) => c.liquidadas[t] || c.calculadas[t])
      .map((t) => `<tr><td><span class="punto punto-${t}"></span>Horas ${HORAS_TIPO[t]}
        <span class="tenue">(calendario ${c.calculadas[t]}h)</span></td>
        <td class="cifra">${c.liquidadas[t]}h${c.diferencias[t] && !c.calendarioVacio
          ? ` <span class="salto">${c.diferencias[t] > 0 ? "+" : ""}${c.diferencias[t]}h</span>` : ""}</td></tr>`).join("");
    const d = c.diferenciaImporte;
    const causa = c.porHorarioSAS
      ? " La diferencia sale de que el SAS liquida de 08:00 a 08:00 aunque entres o salgas a las 09:00."
      : " Revisa también que no falte ni sobre ninguna guardia en el calendario.";
    const veredicto = c.calendarioVacio
      ? "No tienes guardias apuntadas este mes: apúntalas en el calendario y aquí verás si te han pagado todas las horas."
      : c.cuadra
      ? "Te han pagado exactamente las horas que hiciste."
      : d < 0
        ? `Te han pagado <strong>${eur(-d)} menos</strong> de lo que hiciste: puedes reclamarlo.${causa}`
        : d > 0
          ? `Te han pagado ${eur(d)} más de lo que sale de tus horas.${causa}`
          : `Las horas no coinciden por tipo aunque el importe sea el mismo.${causa}`;
    const n = nominaDe(estado.nominas, mesVisible, "guardias");
    const reclamada = n && typeof n.reclamada === "string"
      ? ` <strong>Reclamada el ${esc(n.reclamada.split("-").reverse().join("/"))}.</strong>` : "";
    return `<div class="tarjeta">
      <strong class="etiqueta">Liquidado por el SAS</strong>
      <table>${filas}
        <tr><td>Guardias</td><td class="cifra">${eur(c.importeLiquidado)}${c.diferenciaImporte && !c.calendarioVacio
          ? ` <span class="salto">${c.diferenciaImporte > 0 ? "+" : ""}${eur(c.diferenciaImporte)}</span>` : ""}</td></tr>
        ${c.prorrataVacaciones ? `<tr><td>Prorrata de vacaciones${c.diasVacaciones
          ? ` <span class="tenue">(${c.diasVacaciones} días)</span>` : ""}</td><td class="cifra">${eur(c.prorrataVacaciones)}</td></tr>` : ""}
      </table>
      <p class="aviso">${veredicto}${d < 0 && !c.calendarioVacio ? reclamada : ""}${c.prorrataVacaciones
        ? " La prorrata de vacaciones se paga aparte: no es ninguna guardia del calendario." : ""}</p>
    </div>`;
  }

  function filaTipo(tipo, r) {
    if (r.horasPorTipo[tipo] === 0) return "";
    const nombre = { laborable: "Laborable", sdf: "Festiva (S-D-F)", especial: "Festivo especial" }[tipo];
    return `<tr><td><span class="punto punto-${tipo}"></span>${nombre} <span class="tenue">(${r.horasPorTipo[tipo]}h)</span></td>
      <td class="cifra">${eur(r.importePorTipo[tipo])}</td></tr>`;
  }

  function vistaFestivos() {
    const anio = Number(mesVisible.slice(0, 4));
    const calendario = calendarioDe(anio, estado.festivos);
    const locales = Object.values(calendario).filter((f) => f.ambito === "local").length;
    const filas = Object.entries(calendario).sort().map(([fecha, f]) => `
      <tr><td>${fecha} ${esc(f.nombre)}${f.repetido && f.clase !== "laborable" ? ` <span class="tenue">(se repite cada año)</span>` : ""}${
        f.ambito === "local" && f.clase === "laborable" ? ` <span class="tenue">(este año no es festivo)</span>` : ""}</td><td class="cifra">
        <button data-festivo="${fecha}" data-clase="sdf" class="${f.clase === "sdf" ? "activo" : ""}">S-D-F</button>
        <button data-festivo="${fecha}" data-clase="especial" class="${f.clase === "especial" ? "activo" : ""}">especial</button>
      </td></tr>`).join("");
    return `<div class="tarjeta">
      <strong class="etiqueta">Festivos de ${anio}</strong>
      <table>${filas}</table>
      <p class="aviso">Marca como especial los que se retribuyan a la tarifa doble.
        Tienes ${locales} festivo${locales === 1 ? "" : "s"} local${locales === 1 ? "" : "es"}
        dado${locales === 1 ? "" : "s"} de alta para ${anio}; cada municipio tiene dos.</p>
      <p class="etiqueta-campo">Añadir festivo local</p>
      <div class="formulario">
        <input type="date" id="f-fecha">
        <input id="f-nombre" placeholder="Nombre del festivo" size="14">
        <button class="primario" id="f-anadir">Añadir</button>
      </div>
      <label><input type="checkbox" id="f-repetir" checked> Repetir cada año en la misma fecha</label>
      <p class="aviso">Los festivos locales se repiten solos los años siguientes. Si un año
        cambia de fecha, pulsa su botón marcado para quitarlo solo ese año.</p></div>`;
  }

  // Redondeo de dos decimales con coma, para prellenar inputs con el mismo
  // formato que espera el usuario al escribir a mano (no el punto de JS).
  // null pasa a cadena vacia: puede llegar de sincronizar una tarjeta cuyo
  // campo opcional el usuario borro a mano antes de anadir otro PDF.
  const cifra = (n) => (n == null ? "" : n.toFixed(2).replace(".", ","));

  // Comparte las reglas de validacion entre el alta manual y las tarjetas de
  // revision de PDF: un solo sitio donde tocarlas si cambian.
  function construirNomina({ periodo, clase, bruto, neto, cotizacion, irpf }, excluir = null) {
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      return { ok: false, error: "El periodo se escribe como 2026-09." };
    }
    if (!(bruto > 0) || !(neto > 0)) {
      return { ok: false, error: "Bruto y neto tienen que ser mayores que cero." };
    }
    if (neto > bruto) {
      return { ok: false, error: "El neto no puede ser mayor que el bruto." };
    }
    // Una nomina por periodo y clase: subir dos veces el mismo PDF la
    // duplicaria en la lista sin avisar.
    if (estado.nominas.some((n) => n !== excluir && n.periodo === periodo && n.clase === clase)) {
      return {
        ok: false,
        error: `Ya tienes registrada la nómina ${clase === "base" ? "base" : "de guardias"} de ${periodo}. `
          + "Si quieres cambiarla, usa el botón ✎ de la lista.",
      };
    }
    const nomina = { periodo, clase, bruto: redondear(bruto), neto: redondear(neto) };
    // Cero es un valor legitimo: hasta la primera regularizacion el IRPF de
    // un residente suele ser 0. Por eso se mira si el campo esta vacio, no
    // si vale mas que cero.
    const hayDesglose = cotizacion !== null || irpf !== null;
    if (hayDesglose) {
      if (cotizacion === null || irpf === null) {
        return { ok: false, error: "Si desglosas, pon las dos: cotización e IRPF. Si una es cero, escribe 0." };
      }
      if (!(cotizacion >= 0) || !(irpf >= 0)) {
        return { ok: false, error: "La cotización y el IRPF no pueden ser negativos." };
      }
      if (Math.abs(cotizacion + irpf - (bruto - neto)) > 0.02) {
        return {
          ok: false,
          error: `Cotización + IRPF son ${eur(redondear(cotizacion + irpf))}, `
            + `pero del bruto al neto van ${eur(redondear(bruto - neto))}. Revísalo.`,
        };
      }
      nomina.cotizacion = redondear(cotizacion);
      nomina.irpf = redondear(irpf);
    }
    return { ok: true, nomina };
  }

  // Lee los campos de un formulario de nomina del DOM. `idDe` traduce cada
  // nombre de campo a su selector: el alta manual y cada tarjeta pendiente
  // usan ids distintos (fijos una, con el indice la otra), pero los campos
  // son los mismos, asi que la lectura tambien puede serlo.
  function leerNomina(idDe) {
    const leer = (id) => raiz.querySelector(id).value.replace(",", ".");
    const cotTexto = raiz.querySelector(idDe("cotizacion")).value.trim();
    const irpfTexto = raiz.querySelector(idDe("irpf")).value.trim();
    return {
      periodo: raiz.querySelector(idDe("periodo")).value.trim(),
      clase: raiz.querySelector(idDe("clase")).value,
      bruto: Number(leer(idDe("bruto"))),
      neto: Number(leer(idDe("neto"))),
      cotizacion: cotTexto === "" ? null : Number(cotTexto.replace(",", ".")),
      irpf: irpfTexto === "" ? null : Number(irpfTexto.replace(",", ".")),
    };
  }

  // Una tarjeta de revision por PDF leido: los campos ya vienen rellenos pero
  // editables, y no se guarda nada hasta que se pulsa "Anadir" en la propia
  // tarjeta. Si el PDF no se pudo parsear, se enseña el motivo en su lugar.
  function vistaPendiente(p, i) {
    if (!p.ok) {
      return `<div class="tarjeta">
        <strong class="etiqueta">${esc(p.nombreArchivo)}</strong>
        <p class="aviso">${esc(p.error)}</p>
        <button data-pend-descartar="${i}">Descartar</button></div>`;
    }
    const d = p.datos;
    return `<div class="tarjeta">
      <strong class="etiqueta">${esc(p.nombreArchivo)}</strong>
      <div class="formulario">
        <input id="pend-periodo-${i}" value="${esc(d.periodo)}" size="8">
        <select id="pend-clase-${i}">
          <option value="base" ${d.clase === "base" ? "selected" : ""}>Base</option>
          <option value="guardias" ${d.clase === "guardias" ? "selected" : ""}>Guardias</option>
        </select>
        <input id="pend-bruto-${i}" value="${cifra(d.bruto)}" size="8">
        <input id="pend-neto-${i}" value="${cifra(d.neto)}" size="8">
      </div>
      <div class="formulario">
        <input id="pend-cotizacion-${i}" value="${cifra(d.cotizacion)}" size="10">
        <input id="pend-irpf-${i}" value="${cifra(d.irpf)}" size="8">
        <button class="primario" data-pend-anadir="${i}">${p.editando ? "Guardar" : "Añadir"}</button>
        <button data-pend-descartar="${i}">Descartar</button>
      </div>
      ${p.original?.desglose ? `<p class="tenue">${esc(textoDesglose(p.original))}</p>` : ""}
      ${(p.avisos || []).map((a) => `<p class="aviso">${esc(a)}</p>`).join("")}
      <p class="aviso" id="pend-error-${i}"></p></div>`;
  }

  // Resumen en una linea de lo que trae una nomina ademas de los totales.
  function textoDesglose(n) {
    const d = n.desglose;
    if (!d || typeof d !== "object") return "";
    const partes = [];
    if (d.horas) {
      const h = ["laborable", "sdf", "especial"].filter((t) => d.horas[t])
        .map((t) => `${d.horas[t]}h ${HORAS_TIPO[t]}`);
      if (h.length) partes.push(`${h.join(" + ")} (${eur(Number(d.guardias) || 0)})`);
    }
    if (d.prorrataVacaciones) {
      partes.push(`prorrata de vacaciones ${eur(d.prorrataVacaciones)}${d.diasVacaciones ? ` por ${d.diasVacaciones} días` : ""}`);
    }
    if (d.pagaExtra) partes.push(`paga extra ${eur(d.pagaExtra)}`);
    if (n.irpf) partes.push(`IRPF ${eur(n.irpf)}`);
    for (const o of d.otros || []) partes.push(`${o.nombre} ${eur(o.importe)}`);
    return partes.join(" · ");
  }

  function vistaNominas() {
    const t = tiposEfectivos(estado.nominas, estado.config);
    const filas = estado.nominas.map((n, i) => `
      <tr><td>${esc(n.periodo)} ${esc(n.clase)}${n.desglose
        ? `<br><span class="tenue">${esc(textoDesglose(n))}</span>` : ""}</td><td class="cifra">${eur(n.bruto)} → ${eur(n.neto)}
      <button data-editar-nomina="${i}" aria-label="Editar">✎</button>
      <button class="peligro" data-borrar-nomina="${i}" aria-label="Borrar">×</button></td></tr>`).join("");
    const desfase = tarifasDesfasadas(estado);
    const TIPO_TARIFA = { laborable: "laborable", sdf: "festiva (S-D-F)", especial: "de festivo especial" };
    const avisoTarifas = desfase ? `<div class="tarjeta"><strong class="etiqueta">Tarifas de guardia</strong>
      <p class="aviso">Tu nómina de ${esc(desfase.periodo)} paga ${Object.entries(desfase.distintos)
        .map(([t, v]) => `la hora ${TIPO_TARIFA[t]} a <strong>${eur(v.nomina)}</strong> (la app prevé con ${eur(v.app)})`)
        .join(" y ")}. Los meses con nómina ya se calculan con lo pagado; para que las previsiones
        de los siguientes cuadren, actualiza las tarifas de R${desfase.anio}.</p>
      <button class="primario" id="n-actualizar-tarifas">Actualizar tarifas de R${desfase.anio}</button></div>` : "";
    return `${avisoTarifas}<div class="tarjeta"><strong class="etiqueta">Nóminas registradas</strong>
      ${deshacer ? `<p class="aviso">Nómina ${esc(deshacer.nomina.periodo)} ${esc(deshacer.nomina.clase)} borrada.
        <button data-deshacer>Deshacer</button></p>` : ""}
      <table>${filas}</table>
      ${bloqueRetencion("base", "Base", t.base, t.nBase)}
      ${bloqueRetencion("guardias", "Guardias", t.guardias, t.nGuardias)}
      <div class="formulario">
        <input type="file" id="n-pdf-input" accept="application/pdf" multiple>
      </div>
      ${estadoPdf ? `<p class="aviso">${esc(estadoPdf)}</p>` : ""}
      ${pendientesNomina.map(vistaPendiente).join("")}
      <div class="formulario">
        <input id="n-periodo" placeholder="2026-09" size="8">
        <select id="n-clase"><option value="base">Base</option><option value="guardias">Guardias</option></select>
        <input id="n-bruto" placeholder="Bruto" size="8">
        <input id="n-neto" placeholder="Neto" size="8">
        <button class="primario" id="n-anadir">Añadir</button>
      </div>
      <div class="formulario">
        <input id="n-cotizacion" placeholder="Cotización €" size="10">
        <input id="n-irpf" placeholder="IRPF €" size="8">
      </div>
      <p class="aviso" id="n-error">Los dos últimos son opcionales, pero si los
        copias de la nómina puedo separar lo fijo (cotización) de lo que varía (IRPF).</p></div>
      ${vistaDiferencias()}`;
  }

  // Lo que el SAS ha pagado de mas o de menos respecto a las horas del
  // calendario, mes a mes, y lo que queda por reclamar.
  function vistaDiferencias() {
    const r = diferenciasConSAS(estado);
    if (r.filas.length === 0) return "";
    const fecha = (iso) => iso.split("-").reverse().join("/");
    const filas = r.filas.map((f) => {
      const horas = Object.entries(f.diferencias)
        .map(([t, h]) => `${h > 0 ? "+" : ""}${h}h ${HORAS_TIPO[t]}`).join(", ");
      const accion = f.diferencia < 0
        ? (f.reclamada
          ? `<br><span class="tenue">Reclamada el ${esc(fecha(f.reclamada))}</span> <button data-reclamar="${esc(f.periodo)}">Desmarcar</button>`
          : `<br><button data-reclamar="${esc(f.periodo)}">Marcar como reclamada</button>`)
        : "";
      return `<tr><td>${esc(f.periodo)} <span class="tenue">(${esc(horas)})</span>${accion}</td>
        <td class="cifra">${f.diferencia > 0 ? "+" : ""}${eur(f.diferencia)}</td></tr>`;
    }).join("");
    return `<div class="tarjeta"><strong class="etiqueta">Diferencias con el SAS</strong>
      <table>${filas}
        <tr><td>Te deben (sin reclamar)</td><td class="cifra">${eur(r.pendienteReclamar)}</td></tr>
        <tr><td>Te pagaron de más</td><td class="cifra">${eur(r.pagadoDeMas)}</td></tr>
        <tr><td class="total">Saldo</td><td class="cifra total">${r.saldo > 0 ? "+" : ""}${eur(r.saldo)}</td></tr>
      </table>
      <p class="aviso">Negativo: te pagaron menos horas de las que hiciste. Positivo: más.
        El saldo junta todos los meses; lo que te pagaron de más puede compensar lo que te deben.</p></div>`;
  }

  // El tipo de IRPF se regulariza y puede moverse mes a mes. Se enseña la deriva
  // en vez de un solo numero, y se marcan los saltos grandes.
  function bloqueRetencion(clase, titulo, tipoVigente, cuantas) {
    const h = historialTipos(estado.nominas, clase);
    if (h.length === 0) {
      return `<p class="tenue">Retención de ${titulo.toLowerCase()}:
        <strong>${(tipoVigente * 100).toFixed(2)} %</strong> — valor por defecto,
        aún sin nóminas registradas.</p>`;
    }
    const pasos = h.map((f, i) => {
      const ultimo = i === h.length - 1;
      // Con desglose se enseña el IRPF, que es lo que deriva; la cotizacion va
      // aparte y en tenue, porque es de tipo fijo y no dice nada nuevo.
      const cifra = f.tipoIrpf !== null
        ? `<b>${(f.tipoIrpf * 100).toFixed(2)} %</b><span class="fijo">+${(f.tipoCotizacion * 100).toFixed(2)} cot.</span>`
        : `<b>${(f.tipo * 100).toFixed(2)} %</b>`;
      const marca = f.esSalto
        ? `<span class="salto">${f.salto > 0 ? "▲" : "▼"} ${Math.abs(f.salto * 100).toFixed(2)}</span>`
        : "";
      const aviso = f.cuadra ? "" : `<span class="salto" title="El desglose no cuadra con el neto">⚠</span>`;
      return `<span class="paso${ultimo ? " vigente" : ""}">${esc(f.periodo)}
        ${cifra}${marca}${aviso}</span>`;
    }).join('<span class="flecha">→</span>');
    const saltos = h.filter((f) => f.esSalto);
    const desglosadas = h.filter((f) => f.tipoIrpf !== null).length;
    return `
      <p class="etiqueta-campo">Retención de ${titulo.toLowerCase()}</p>
      <div class="historial">${pasos}</div>
      ${saltos.length ? `<p class="aviso">El tipo cambió de golpe en
        ${saltos.map((s) => esc(s.periodo)).join(", ")}. Suele ser una regularización
        de Hacienda: las previsiones de los meses anteriores se quedaron
        ${saltos[saltos.length - 1].salto > 0 ? "largas" : "cortas"}.</p>`
        : `<p class="aviso">Estable en ${cuantas} ${cuantas === 1 ? "nómina" : "nóminas"}.
        Se usa el último valor para las previsiones.${desglosadas === 0
          ? " Si copias la cotización y el IRPF de tu nómina, puedo seguir solo la parte que varía."
          : ""}</p>`}`;
  }

  function vistaAnual() {
    const anio = Number(mesVisible.slice(0, 4));
    const r = resumenAnio(anio, estado);
    return `<div class="tarjeta"><strong class="etiqueta">Resumen de ${anio}</strong><table>
      <tr><td><span class="punto punto-laborable"></span>Horas laborables</td><td class="cifra">${r.horasPorTipo.laborable}h</td></tr>
      <tr><td><span class="punto punto-sdf"></span>Horas festivas (S-D-F)</td><td class="cifra">${r.horasPorTipo.sdf}h</td></tr>
      <tr><td><span class="punto punto-especial"></span>Horas de festivo especial</td><td class="cifra">${r.horasPorTipo.especial}h</td></tr>
      <tr><td>Bruto del año</td><td class="cifra">${eur(r.bruto)}</td></tr>
      <tr><td class="total">Neto del año</td><td class="cifra total">${eur(r.neto)}</td></tr>
    </table>
    <div class="chips" style="margin-top:.9rem"><button id="descargar-csv">Descargar ${anio} para Excel</button></div>
    <p class="aviso">Un fichero con cada mes: horas, brutos, netos y, si están registradas,
      las cifras de tus nóminas reales (cotización, IRPF, prorrata).</p></div>`;
  }

  function descargarCsv() {
    const anio = Number(mesVisible.slice(0, 4));
    const blob = new Blob([csvAnual(anio, estado)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cuadrante-${anio}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function abrirModal(fecha) {
    // Una guardia nueva arranca con lo que toca ese dia; una ya guardada, con lo suyo.
    const sugerida = sugerenciaPara(fecha, estado.festivos);
    const g = { ...(estado.guardias[fecha]
      || { horas: sugerida.horas, inicio: sugerida.inicio, lugar: "", hecha: false }) };
    const caja = raiz.querySelector("#caja-modal");

    function pintarModal() {
      const r = calcularGuardia({ ...g, fecha }, estado.festivos, configConPrecios(estado));
      const tramos = r.tramos.map((t) => `<tr><td>${t.fecha} ${t.desde}–${t.hasta}</td>
        <td class="cifra">${t.horas}h × ${eur(t.tarifa)} = ${eur(t.importe)}</td></tr>`).join("");
      caja.innerHTML = `
        <strong class="modal-fecha">${fecha}</strong>
        <p class="etiqueta-campo">Duración</p>
        <div class="chips">${DURACIONES.map((h) => `<button data-horas="${h}" class="${g.horas === h ? "activo" : ""}">${h}h</button>`).join(" ")}</div>
        <p class="etiqueta-campo">Hora de inicio <input id="m-inicio" value="${g.inicio}" size="5"></p>
        <p class="etiqueta-campo">Lugar</p>
        <div class="chips">${[...lugaresDe(estado.config),
          ...(g.lugar && !lugaresDe(estado.config).some((l) => l.sigla === g.lugar) ? [{ sigla: g.lugar, nombre: g.lugar }] : [])]
          .map((l) => `<button data-lugar="${esc(l.sigla)}" class="${g.lugar === l.sigla ? "activo" : ""}">${esc(l.nombre)}</button>`).join(" ")}
             <button data-lugar="" class="${g.lugar === "" ? "activo" : ""}">sin especificar</button></div>
        <p><label><input type="checkbox" id="m-hecha" ${g.hecha ? "checked" : ""}> Guardia ya realizada</label></p>
        <table style="margin-top:.75rem">${tramos}
          <tr><td class="total">bruto</td><td class="cifra total">${eur(r.bruto)}</td></tr></table>
        ${(() => {
          const sas = calcularGuardia({ ...g, fecha }, estado.festivos, { ...configConPrecios(estado), horarioSAS: true });
          const d = redondear(sas.bruto - r.bruto);
          return d === 0 ? "" : `<p class="aviso">Aquí se calculan las ${g.horas}h que haces. Ojo: el SAS
            suele liquidar estas guardias de 08:00 a 08:00, y con eso pagaría ${eur(Math.abs(d))}
            ${d > 0 ? "más" : "menos"}${d < 0 ? ": compáralo con la nómina y reclama la diferencia" : ""}.</p>`;
        })()}
        <div class="acciones-modal">
          <button class="peligro" id="m-borrar">Borrar</button>
          <button id="m-cancelar">Cancelar</button>
          <button class="primario" id="m-guardar">Guardar</button>
        </div>`;
    }

    caja.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      // Cambiar la duracion ya no toca la hora de entrada: esa depende del dia,
      // no de lo que dure la guardia.
      if (b.dataset.horas) { g.horas = Number(b.dataset.horas); pintarModal(); }
      else if ("lugar" in b.dataset) { g.lugar = b.dataset.lugar; pintarModal(); }
      else if (b.id === "m-cancelar") cerrarModal();
      else if (b.id === "m-borrar") { delete estado.guardias[fecha]; persistir(); cerrarModal(); pintar(); }
      else if (b.id === "m-guardar") {
        const valorInicio = caja.querySelector("#m-inicio").value;
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(valorInicio)) g.inicio = valorInicio;
        g.hecha = caja.querySelector("#m-hecha").checked;
        estado.guardias[fecha] = g; persistir(); cerrarModal(); pintar();
      }
    };
    caja.oninput = (ev) => {
      if (ev.target.id === "m-inicio" && /^([01]\d|2[0-3]):[0-5]\d$/.test(ev.target.value)) {
        g.inicio = ev.target.value;
        const foco = ev.target.selectionStart;
        pintarModal();
        const campo = caja.querySelector("#m-inicio");
        campo.focus();
        campo.setSelectionRange(foco, foco);
      }
    };
    pintarModal();
    raiz.querySelector("#modal").classList.add("abierto");
  }

  function cerrarModal() {
    ajustesAbierto = false;
    raiz.querySelector("#modal").classList.remove("abierto");
  }

  // Dos canales posibles: Firebase (si hay sesion de Google, sincroniza de
  // verdad entre dispositivos) y el Artifact de Claude (solo si la app vive
  // ahi). Se prioriza Firebase en el mensaje porque es el que el usuario
  // controla con su sesion; el del Artifact es un extra silencioso.
  function textoEstadoGuardado() {
    if (sesion) {
      const e = sinc.estadoActual;
      if (e === "al-dia") return "Copia en la nube (Google): al día.";
      if (e === "pendiente") return "Copia en la nube (Google): guardando…";
      if (e === "comprobando") return "Copia en la nube (Google): comprobando…";
      return "Copia en la nube (Google): no disponible ahora mismo. Tus datos siguen "
        + "a salvo en este navegador.";
    }
    const e = guardarRemoto.estadoActual;
    if (e === "al-dia") {
      return "Copia en el Artifact: al día. Inicia sesión con Google arriba para "
        + "sincronizar entre dispositivos.";
    }
    if (e === "pendiente") return "Copia en el Artifact: guardando…";
    return "Sin copia en la nube activa. Inicia sesión con Google arriba para "
      + "sincronizar entre dispositivos, o copia este texto como respaldo.";
  }

  function abrirAjustes() {
    ajustesAbierto = true;
    const caja = raiz.querySelector("#caja-modal");
    const c = estado.config;
    const r = retribucionesDe(c);
    const anioEnCurso = Number(hoyISO().slice(0, 4));
    const filas = [1, 2, 3, 4, 5].map((n) => `
      <tr><td>R${n}</td><td class="cifra">
        <input data-tarifa="${n}.laborable" value="${r.guardias[n].laborable}" size="4">
        <input data-tarifa="${n}.sdf" value="${r.guardias[n].sdf}" size="4">
        <input data-tarifa="${n}.especial" value="${r.guardias[n].especial}" size="4">
      </td></tr>`).join("");

    caja.innerHTML = `
      <div class="modal-fecha-grupo">
        <img class="logo-ajustes" src="${LOGO_URI}" alt="">
        <strong class="modal-fecha">Ajustes</strong>
      </div>

      <details class="guia">
        <summary>Cómo usarla</summary>
        <ol>
          <li><strong>Empieza</strong> poniendo tu fecha de inicio de residencia (aquí abajo). Con ella se
            calcula tu año de residencia y tus tarifas.</li>
          <li><strong>Festivos locales:</strong> en la pestaña Festivos añade los dos de tu municipio. Se
            repiten solos cada año.</li>
          <li><strong>Guardias:</strong> toca un día del calendario, elige duración y lugar, y márcala como
            realizada cuando la hagas. Las de borde punteado son previsión.</li>
          <li><strong>Nóminas:</strong> cada mes sube los dos PDF del SAS (Normal y Complementaria) en la
            pestaña Nóminas, revisa la tarjeta y pulsa Añadir. La Complementaria se guarda en el mes de las
            guardias que paga (la de septiembre, en agosto).</li>
          <li><strong>Liquidado por el SAS:</strong> en el calendario de cada mes con nómina verás las horas
            pagadas frente a las tuyas. Si te pagan de menos, lo tienes en «Diferencias con el SAS» para
            reclamarlo y marcarlo como reclamado.</li>
          <li><strong>Lo que ingresas:</strong> sale de tus nóminas reales cuando están subidas; si no, es una
            previsión. Incluye la paga extra de junio y diciembre.</li>
          <li><strong>Copia en la nube:</strong> inicia sesión con Google aquí abajo para no perder nada y verlo
            en el móvil y el ordenador. Cada cuenta ve solo sus datos.</li>
          <li><strong>Resumen del año:</strong> en la pestaña Anual puedes descargarlo para Excel.</li>
        </ol>
        <p class="aviso">Las tarifas son las del anexo XVI de 2026 del SAS. Si tu nómina paga otra cosa, la
          app te avisará en la pestaña Nóminas.</p>
      </details>

      <p class="etiqueta-campo">Cuenta</p>
      ${sesion ? `
        <div class="cuenta-fila">
          ${sesion.foto ? `<img class="avatar-cuenta" src="${esc(sesion.foto)}" alt="">` : ""}
          <span class="tenue">${esc(sesion.nombre || sesion.correo || "Sesión iniciada")}</span>
        </div>
        <div class="chips" style="margin-top:.5rem"><button id="a-cerrar-sesion">Cerrar sesión</button></div>
      ` : `
        <div class="chips"><button id="a-iniciar-sesion" class="primario">Iniciar sesión con Google</button></div>
        <p class="aviso">Sincroniza tus guardias entre el móvil y el ordenador.</p>
      `}

      <p class="etiqueta-campo">Aspecto</p>
      <div class="chips">
        <button data-tema="sobrio" class="${(c.tema || "sobrio") === "sobrio" ? "activo" : ""}">Sobrio</button>
        <button data-tema="espacial" class="${c.tema === "espacial" ? "activo" : ""}">Una galaxia muy lejana</button>
      </div>
      ${c.tema === "espacial" ? `<div class="chips" style="margin-top:.4rem">
        <button id="a-intro">▶ Ver la intro</button></div>
        ${window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? `<p class="aviso">Tu sistema pide reducir las animaciones, así que la
             intro no salta sola al empezar. Desde aquí se reproduce igualmente.</p>`
          : ""}` : ""}

      <p class="etiqueta-campo">Inicio de residencia</p>
      <input type="date" id="a-inicio" value="${c.inicioResidencia || ""}">

      <p class="etiqueta-campo">Reparto de la guardia a medianoche</p>
      <label><input type="checkbox" id="a-corte" ${c.cortarAMedianoche ? "checked" : ""}>
        Partir las guardias a medianoche</label><br>
      <label><input type="checkbox" id="a-corte-esp" ${c.especialCortaAMedianoche ? "checked" : ""}>
        Partir también las de festivo especial</label>
      <p class="aviso">Comprobado con las nóminas de julio y agosto de 2026: el SAS parte
        las guardias a medianoche.</p>

      <p class="etiqueta-campo">Lugares de guardia</p>
      <textarea id="a-lugares" rows="5" spellcheck="false">${esc(textoLugares(lugaresDe(c)))}</textarea>
      <p class="aviso">Uno por línea: la sigla y el nombre (por ejemplo «URG Puerta de Urgencias»).
        Las guardias ya apuntadas conservan su sigla aunque la quites de aquí.</p>

      <p class="etiqueta-campo">Retenciones por defecto</p>
      <label>Base <input id="a-ret-base" value="${(c.retencionBase * 100).toFixed(4)}" size="6"> %</label>
      <label>Guardias <input id="a-ret-guardias" value="${(c.retencionGuardias * 100).toFixed(4)}" size="6"> %</label>
      <p class="aviso">Solo se usan mientras no registres ninguna nómina de esa clase.
        En cuanto registras una, manda la más reciente.</p>

      <p class="etiqueta-campo">Valor hora (laborable / S-D-F / especial)</p>
      <table>${filas}</table>
      <p class="etiqueta-campo">Sueldo base</p>
      <input id="a-sueldo" value="${r.sueldoBase}" size="8">
      <p class="aviso">Valores del anexo XVI, 2026.${
        anioEnCurso > 2026
          ? ` Estamos en ${anioEnCurso}: contrástalos con tu nómina, el SAS los actualiza por convenio.`
          : ""}</p>

      <p class="etiqueta-campo">Copia de seguridad</p>
      <textarea id="a-datos" rows="4" spellcheck="false">${esc(JSON.stringify(estado))}</textarea>
      <div class="chips">
        <button id="a-copiar">Copiar</button>
        <button id="a-importar">Importar lo pegado</button>
        <button class="peligro" id="a-borrar-todo">Borrar todo</button>
      </div>
      <p class="aviso" id="a-estado-nube">${textoEstadoGuardado()}</p>
      <p class="aviso" id="a-error"></p>

      <div class="acciones-modal">
        <button id="a-cancelar">Cancelar</button>
        <button class="primario" id="a-guardar">Guardar</button>
      </div>`;

    caja.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.id === "a-iniciar-sesion") {
        b.disabled = true;
        b.textContent = "Abriendo Google…";
        iniciarSesion().catch((err) => {
          caja.querySelector("#a-error").textContent = err.message
            || "No se ha podido iniciar sesión. Inténtalo de nuevo.";
          b.disabled = false;
          b.textContent = "Iniciar sesión con Google";
        });
      }
      else if (b.id === "a-cerrar-sesion") {
        // Antes de salir se sube lo que quede pendiente (con un tope, por si
        // no hay conexion: lo no subido queda en este dispositivo).
        b.disabled = true;
        b.textContent = "Cerrando…";
        Promise.race([sinc.ahora(), new Promise((r) => setTimeout(r, 4000))])
          .catch(() => {}).then(() => cerrarSesion());
      }
      else if (b.dataset.tema) {
        c.tema = b.dataset.tema;
        document.documentElement.dataset.tema = c.tema;
        persistir();
        abrirAjustes(); // se repinta para que el boton activo sea el nuevo
      }
      else if (b.id === "a-intro") { cerrarModal(); lanzarIntro(true); }
      else if (b.id === "a-cancelar") cerrarModal();
      else if (b.id === "a-guardar") {
        const inicio = caja.querySelector("#a-inicio").value;
        if (/^\d{4}-\d{2}-\d{2}$/.test(inicio)) c.inicioResidencia = inicio;
        c.cortarAMedianoche = caja.querySelector("#a-corte").checked;
        c.especialCortaAMedianoche = caja.querySelector("#a-corte-esp").checked;
        c.retencionBase = leerPorcentaje(caja, "#a-ret-base", c.retencionBase);
        c.retencionGuardias = leerPorcentaje(caja, "#a-ret-guardias", c.retencionGuardias);
        c.retribuciones = leerRetribuciones(caja, r);
        // Si la lista es la de siempre no se guarda: asi quien no la toca
        // recibe los cambios futuros de la lista por defecto.
        const lugares = leerLugares(caja.querySelector("#a-lugares").value);
        if (textoLugares(lugares) === textoLugares(LUGARES)) delete c.lugares;
        else c.lugares = lugares;
        persistir(); cerrarModal(); pintar();
      }
      else if (b.id === "a-copiar") {
        const campo = caja.querySelector("#a-datos");
        campo.select();
        navigator.clipboard.writeText(campo.value).then(
          () => { b.textContent = "Copiado"; },
          () => { b.textContent = "Copialo a mano"; });
      }
      else if (b.id === "a-importar") {
        const r = importarEstado(caja.querySelector("#a-datos").value);
        if (!r.ok) {
          caja.querySelector("#a-error").textContent = r.error;
        } else {
          // El tema no viene en la copia: se conserva el de este dispositivo.
          const tema = estado.config.tema;
          Object.assign(estado, r.estado);
          estado.config.tema = tema;
          persistir(); cerrarModal(); pintar();
          if (r.descartadas > 0) {
            avisarDescartes(r.descartadas);
          }
        }
      }
      else if (b.id === "a-borrar-todo") {
        // Dos pulsaciones en vez de confirm(): un dialogo modal del navegador
        // bloquea la pagina y no se puede recuperar desde el artifact.
        if (b.dataset.confirmado) {
          Object.assign(estado, estadoInicial());
          persistir(); cerrarModal(); pintar();
        } else {
          b.dataset.confirmado = "1";
          b.textContent = "Pulsa otra vez para confirmar";
        }
      }
    };
    caja.oninput = null;
    raiz.querySelector("#modal").classList.add("abierto");
  }

  function leerPorcentaje(caja, selector, actual) {
    const valor = Number(caja.querySelector(selector).value.replace(",", "."));
    return valor >= 0 && valor < 100 ? Math.round((valor / 100) * 1e6) / 1e6 : actual;
  }

  // Devuelve null si todo coincide con el anexo, para que quien no toca nada siga
  // recibiendo las correcciones futuras del codigo en vez de congelar una copia.
  function leerRetribuciones(caja, actuales) {
    const guardias = {};
    let cambiado = false;
    for (const n of [1, 2, 3, 4, 5]) {
      guardias[n] = { ...actuales.guardias[n] };
      for (const tipo of ["laborable", "sdf", "especial"]) {
        const campo = caja.querySelector(`[data-tarifa="${n}.${tipo}"]`);
        const valor = Number(campo.value.replace(",", "."));
        if (valor > 0) guardias[n][tipo] = valor;
        if (valor > 0 && valor !== RETRIBUCIONES_ANEXO.guardias[n][tipo]) cambiado = true;
      }
    }
    const sueldo = Number(caja.querySelector("#a-sueldo").value.replace(",", "."));
    const sueldoBase = sueldo > 0 ? sueldo : actuales.sueldoBase;
    if (sueldoBase !== RETRIBUCIONES_ANEXO.sueldoBase) cambiado = true;
    return cambiado
      ? { guardias, sueldoBase, cgFormacion: { ...actuales.cgFormacion } }
      : null;
  }

  // Se avisa en la propia vista, no con alert(): un dialogo del navegador
  // bloquea la pagina y desde el artifact no hay forma de recuperarla.
  function avisarDescartes(cuantas) {
    const vista = raiz.querySelector("#vista");
    const nota = document.createElement("p");
    nota.className = "aviso";
    nota.textContent = `Se importó la copia, pero ${cuantas} `
      + `${cuantas === 1 ? "entrada no era válida y se descartó" : "entradas no eran válidas y se descartaron"}.`;
    vista.prepend(nota);
  }

  raiz.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pestana], [data-mes], [data-fecha], [data-festivo], [data-borrar-nomina], [data-editar-nomina], [data-deshacer], [data-reclamar], [data-pend-anadir], [data-pend-descartar], #n-anadir, #n-actualizar-tarifas, #descargar-csv, #b-empezar, #abrir-ajustes, #f-anadir, #marcar-mes");
    if (!b) return;
    if (b.id === "abrir-ajustes") abrirAjustes();
    else if (b.id === "b-empezar") {
      const valor = raiz.querySelector("#b-inicio").value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        estado.config.inicioResidencia = valor;
        persistir(); pintar();
        if (estado.config.tema === "espacial") lanzarIntro();
      }
    }
    else if (b.dataset.pestana) { pestana = b.dataset.pestana; pintar(); }
    else if (b.dataset.mes) {
      const [a, m] = mesVisible.split("-").map(Number);
      const d = new Date(a, m - 1 + Number(b.dataset.mes), 1);
      mesVisible = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      pintar();
    }
    else if (b.dataset.fecha) abrirModal(b.dataset.fecha);
    else if (b.dataset.festivo) {
      const fecha = b.dataset.festivo;
      const anio = Number(fecha.slice(0, 4));
      const actual = calendarioDe(anio, estado.festivos)[fecha];
      const nueva = actual.clase === b.dataset.clase ? "laborable" : b.dataset.clase;
      const derivado = calendarioDe(anio, {})[fecha];
      // Si vuelve a coincidir con lo derivado, se borra la excepcion en vez de
      // guardarla: el estado solo debe contener diferencias de verdad.
      if (derivado && derivado.clase === nueva) delete estado.festivos[fecha];
      else if (derivado) estado.festivos[fecha] = { clase: nueva };
      else estado.festivos[fecha] = { nombre: actual.nombre, clase: nueva };
      persistir(); pintar();
    }
    else if (b.id === "marcar-mes") {
      for (const [fecha, g] of Object.entries(estado.guardias)) {
        if (fecha.slice(0, 7) === mesVisible) g.hecha = true;
      }
      persistir(); pintar();
    }
    else if (b.id === "f-anadir") {
      const fecha = raiz.querySelector("#f-fecha").value;
      const nombre = raiz.querySelector("#f-nombre").value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(fecha) && nombre) {
        estado.festivos[fecha] = { nombre, clase: "sdf" };
        if (!raiz.querySelector("#f-repetir").checked) estado.festivos[fecha].repetir = false;
        persistir(); pintar();
      }
    }
    else if (b.id === "descargar-csv") descargarCsv();
    else if (b.id === "n-actualizar-tarifas") {
      const desfase = tarifasDesfasadas(estado);
      if (desfase) {
        // Copia de la tabla vigente (nunca se toca la del anexo), con los
        // precios de la nomina para ese anio de residencia.
        const tabla = JSON.parse(JSON.stringify(retribucionesDe(estado.config)));
        for (const [t, v] of Object.entries(desfase.distintos)) tabla.guardias[desfase.anio][t] = v.nomina;
        estado.config.retribuciones = tabla;
        persistir(); pintar();
      }
    }
    else if (b.dataset.borrarNomina) {
      const indice = Number(b.dataset.borrarNomina);
      const [nomina] = estado.nominas.splice(indice, 1);
      if (deshacer) clearTimeout(deshacer.temporizador);
      deshacer = {
        nomina, indice,
        temporizador: setTimeout(() => { deshacer = null; if (pestana === "nominas") pintar(); }, 10000),
      };
      persistir(); pintar();
    }
    else if ("deshacer" in b.dataset) {
      if (deshacer) {
        clearTimeout(deshacer.temporizador);
        estado.nominas.splice(Math.min(deshacer.indice, estado.nominas.length), 0, deshacer.nomina);
        deshacer = null;
        persistir(); pintar();
      }
    }
    else if (b.dataset.editarNomina) {
      const n = estado.nominas[Number(b.dataset.editarNomina)];
      if (n && !pendientesNomina.some((p) => p.editando === n)) {
        pendientesNomina.push({
          ok: true, nombreArchivo: `Editar ${n.periodo} ${n.clase === "base" ? "base" : "guardias"}`,
          datos: n, original: n, avisos: [], editando: n,
        });
        pintar();
      }
    }
    else if (b.dataset.reclamar) {
      const n = nominaDe(estado.nominas, b.dataset.reclamar, "guardias");
      if (n) {
        if (typeof n.reclamada === "string") delete n.reclamada;
        else n.reclamada = hoyISO();
        persistir(); pintar();
      }
    }
    else if (b.id === "n-anadir") {
      const resultado = construirNomina(leerNomina((campo) => `#n-${campo}`));
      const error = raiz.querySelector("#n-error");
      if (!resultado.ok) {
        error.textContent = resultado.error;
      } else {
        estado.nominas.push(resultado.nomina);
        persistir(); pintar();
      }
    }
    else if (b.dataset.pendAnadir) {
      const i = Number(b.dataset.pendAnadir);
      const p = pendientesNomina[i];
      const campos = leerNomina((campo) => `#pend-${campo}-${i}`);
      const error = raiz.querySelector(`#pend-error-${i}`);
      const o = p.original;
      // Paga extra en un PDF aparte (solo trae la paga): se suma a la nomina
      // base de ese mes en vez de rechazarla como duplicada. No se ha visto
      // aun una real asi, pero si el SAS la emite separada no se pierde.
      const baseDelMes = !p.editando && campos.clase === "base" && nominaDe(estado.nominas, campos.periodo, "base");
      const soloExtra = o?.desglose?.pagaExtra && Math.abs(o.desglose.pagaExtra - o.bruto) <= 0.02
        && o.bruto === redondear(campos.bruto);
      if (baseDelMes && soloExtra && !baseDelMes.desglose?.pagaExtra) {
        const suma = (a, x) => (typeof a === "number" && typeof x === "number" ? redondear(a + x) : undefined);
        baseDelMes.bruto = redondear(baseDelMes.bruto + o.bruto);
        baseDelMes.neto = redondear(baseDelMes.neto + o.neto);
        const cot = suma(baseDelMes.cotizacion, o.cotizacion);
        const irpf = suma(baseDelMes.irpf, o.irpf);
        if (cot === undefined || irpf === undefined) { delete baseDelMes.cotizacion; delete baseDelMes.irpf; }
        else { baseDelMes.cotizacion = cot; baseDelMes.irpf = irpf; }
        baseDelMes.desglose = { ...(baseDelMes.desglose || {}), pagaExtra: o.desglose.pagaExtra };
        pendientesNomina.splice(i, 1);
        persistir(); pintar();
        return;
      }
      const resultado = construirNomina(campos, p.editando || null);
      if (!resultado.ok) {
        error.textContent = resultado.error;
      } else {
        // El desglose leido del PDF solo acompana a la nomina si no se ha
        // cambiado la clase ni el bruto: si se tocan, ya no describe lo guardado.
        if (o?.desglose && o.clase === resultado.nomina.clase && o.bruto === resultado.nomina.bruto) {
          resultado.nomina.desglose = o.desglose;
        }
        if (p.editando) {
          // La marca de reclamada sigue a la nomina mientras no cambie de mes o clase.
          if (typeof o.reclamada === "string" && o.periodo === resultado.nomina.periodo
            && o.clase === resultado.nomina.clase) resultado.nomina.reclamada = o.reclamada;
          const j = estado.nominas.indexOf(p.editando);
          if (j >= 0) estado.nominas[j] = resultado.nomina;
          else estado.nominas.push(resultado.nomina);
        } else {
          estado.nominas.push(resultado.nomina);
        }
        pendientesNomina.splice(i, 1);
        persistir(); pintar();
      }
    }
    else if (b.dataset.pendDescartar) {
      pendientesNomina.splice(Number(b.dataset.pendDescartar), 1);
      pintar();
    }
  });

  // Se procesan los PDF elegidos y se anaden como tarjetas de revision; nada
  // se guarda en el estado todavia. Si pdf.js no llega a cargar (sin red) o
  // un PDF concreto no encaja con el formato esperado, se enseña el motivo
  // en su tarjeta en vez de dejar el boton sin respuesta.
  raiz.addEventListener("change", async (ev) => {
    if (ev.target.id !== "n-pdf-input") return;
    const archivos = [...ev.target.files];
    if (archivos.length === 0) return;
    // El pintar() de abajo va a regenerar las tarjetas ya en pantalla a
    // partir de pendientesNomina: si el usuario habia corregido algo a mano
    // en una tarjeta anterior sin pulsar "Anadir" todavia, se guarda esa
    // edicion antes de repintar para no perderla.
    pendientesNomina.forEach((p, i) => {
      if (p.ok) p.datos = leerNomina((campo) => `#pend-${campo}-${i}`);
    });
    estadoPdf = archivos.length === 1 ? "Leyendo 1 PDF…" : `Leyendo ${archivos.length} PDF…`;
    pintar();
    // Cada PDF se lee de forma independiente, asi que se procesan en
    // paralelo en vez de uno detras de otro.
    const nuevas = await Promise.all(archivos.map(async (archivo) => {
      try {
        const buffer = await archivo.arrayBuffer();
        const texto = await extraerTextoPdf(buffer);
        const { nomina, avisos } = parsearNomina(texto);
        return { ok: true, nombreArchivo: archivo.name, datos: nomina, original: nomina, avisos };
      } catch (e) {
        return { ok: false, nombreArchivo: archivo.name, error: e.message };
      }
    }));
    pendientesNomina.push(...nuevas);
    estadoPdf = "";
    pintar();
  });

  raiz.querySelector("#modal").addEventListener("click", (ev) => {
    if (ev.target.id === "modal") cerrarModal();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") cerrarModal();
  });

  pintar();

  // Ademas de lo que ya haya en localStorage, se intenta traer la copia
  // guardada en el propio Artifact (si la app vive ahi): es la que sobrevive
  // a que el navegador (sobre todo Safari en el movil) purgue el
  // localStorage de ese iframe de terceros.
  cargarRemoto().then(adoptarRemoto);

  // Y si hay sesion de Google, la copia en Firestore — este es el canal que
  // de verdad sincroniza entre dispositivos (el del Artifact es solo por
  // dispositivo, salvo que Claude comparta el mismo remoto).
  alCambiarSesion((usuario) => {
    sesion = usuario;
    repintarAjustesSiAbierto();
    if (sesion) sinc.ahora();
  }, (err) => {
    // Volviendo de un login por redireccion (movil) que ha fallado: se abre
    // Ajustes con el motivo real en vez de dejar que parezca que "no ha
    // pasado nada" al volver a la pantalla de inicio.
    abrirAjustes();
    const el = raiz.querySelector("#a-error");
    if (el) el.textContent = `Error al volver de Google: ${(err && (err.code || err.message)) || err}`;
  });

  // Una app que se queda abierta dias en el movil no debe trabajar con datos
  // de ayer: al volver a primer plano, y al recuperar la conexion, se vuelve
  // a mirar la nube (y se sube lo que no se pudo subir sin cobertura).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sesion) sinc.ahora();
  });
  window.addEventListener("online", () => { if (sesion) sinc.ahora(); });
}
