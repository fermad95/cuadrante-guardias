// src/nomina-pdf.js
//
// Lee el "Justificante de nómina" en PDF del SAS (Junta de Andalucía) y
// extrae los campos que hacen falta en la pestaña Nóminas. Es una plantilla
// de tabla fija generada por el mismo sistema cada mes, así que un parseo
// por etiqueta ("Total devengos:", "Líquido a percibir:"...) es más fiable
// que leer la tabla de conceptos por posición: un extractor de texto puede
// agrupar columnas enteras de una tabla y desordenar las filas, pero los
// pares "Etiqueta: valor" de cabecera se mantienen pegados.

const CDN_PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76";

let pdfjsPromesa = null;

// pdf.js se carga con import() dinámico, igual que el SDK de Firebase en
// nube.js: si falla por falta de red, no tumba el resto de la app — solo
// falla el botón de importar PDF, y el alta manual sigue funcionando. Si el
// intento falla, no se memoriza el rechazo: se limpia para que el siguiente
// PDF que se suba vuelva a intentar la carga en vez de fallar para siempre
// por un corte de red puntual.
function cargarPdfjs() {
  if (!pdfjsPromesa) {
    pdfjsPromesa = import(`${CDN_PDFJS}/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${CDN_PDFJS}/pdf.worker.min.mjs`;
      return pdfjs;
    }).catch((e) => {
      pdfjsPromesa = null;
      throw e;
    });
  }
  return pdfjsPromesa;
}

// Un item de texto por linea, no separados por espacios: los nombres de los
// conceptos llevan espacios dentro ("COTIZACIÓN DESEMPLEO") y la tabla de
// conceptos solo se puede leer si cada celda queda en su propia linea.
export async function extraerTextoPdf(arrayBuffer) {
  const pdfjs = await cargarPdfjs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pagina = await doc.getPage(1);
  const contenido = await pagina.getTextContent();
  return contenido.items.map((it) => it.str).join("\n");
}

// El SAS emite la nómina Normal (sueldo del mes) y la Complementaria
// (guardias del mes anterior). Si llega otro tipo no se rechaza: la clase se
// deduce de los conceptos que trae y se avisa en la tarjeta de revisión.
const CLASE_POR_EMISION = {
  Normal: "base", Complementaria: "guardias", Extraordinaria: "base", Extra: "base",
};

const ES_IMPORTE = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const ES_CLAVE = /^\d{3}$/;

function numero(texto) {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

const r2 = (n) => Math.round(n * 100) / 100;

function capturar(texto, patron, etiqueta) {
  const m = texto.match(patron);
  if (!m) throw new Error(`No se encontró "${etiqueta}" en el PDF.`);
  return m;
}

function celdas(texto) {
  return texto.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

// La tabla de conceptos sale del PDF por bloques de columnas: primero todas
// las claves de un grupo de filas, luego todas sus denominaciones y luego sus
// cifras columna a columna (una fila suelta puede salir en linea: clave,
// nombre y cifras seguidos). Un grupo con una cifra por fila son devengos;
// con tres (base, porcentaje, importe), descuentos. Cualquier otra forma no
// se adivina: se devuelve null y la nómina se queda solo con los totales.
function leerGrupos(lineas) {
  const devengos = [];
  const descuentos = [];
  let i = 0;
  while (i < lineas.length) {
    const claves = [];
    while (i < lineas.length && ES_CLAVE.test(lineas[i])) claves.push(lineas[i++]);
    const nombres = [];
    while (i < lineas.length && !ES_CLAVE.test(lineas[i]) && !ES_IMPORTE.test(lineas[i])) {
      nombres.push(lineas[i++]);
    }
    const cifras = [];
    while (i < lineas.length && ES_IMPORTE.test(lineas[i])) cifras.push(numero(lineas[i++]));
    const n = claves.length;
    if (n === 0 || nombres.length !== n) return null;
    if (cifras.length === n) {
      claves.forEach((clave, k) => devengos.push({ clave, nombre: nombres[k], importe: cifras[k] }));
    } else if (cifras.length === 3 * n) {
      claves.forEach((clave, k) => descuentos.push({
        clave, nombre: nombres[k], base: cifras[k], porcentaje: cifras[n + k], importe: cifras[2 * n + k],
      }));
    } else {
      return null;
    }
  }
  return { devengos, descuentos };
}

function tramo(lineas, desde, hasta) {
  const i = lineas.findIndex(desde);
  if (i < 0) return [];
  const resto = lineas.slice(i + 1);
  const j = resto.findIndex(hasta);
  return j < 0 ? resto : resto.slice(0, j);
}

// Tabla "Importe unitario": precio de la hora de cada concepto de guardia.
// Sirve para pasar de euros a horas sin depender de las tarifas de la app.
function leerImportesUnitarios(lineas) {
  const t = tramo(lineas, (l) => l === "Importe unitario", () => false)
    .filter((l) => !["Clave", "Denominación conceptos", "Importe"].includes(l));
  const g = t.length ? leerGrupos(t) : null;
  const precios = {};
  if (g) for (const d of g.devengos) precios[d.clave] = d.importe;
  return precios;
}

// Qué es cada concepto se decide por su nombre, no por la clave. Lo que no
// se reconoce no se clasifica a ciegas: queda en "otros" y se avisa.
function clasificarDevengo(nombre) {
  const n = nombre.toUpperCase();
  if (/PRORRATA/.test(n) && /VAC/.test(n)) {
    return { tipo: "prorrata", dia: /SB-?DM-?FE/.test(n) ? "sdf" : "laborable" };
  }
  if (/^JORN\.?\s*COMPLEMENTARIA$/.test(n)) return { tipo: "guardia", dia: "laborable" };
  if (/^JORN\.?\s*COMPLT\.?\s*SB-?DM-?FE$/.test(n)) return { tipo: "guardia", dia: "sdf" };
  if (/^SUELDO$/.test(n)) return { tipo: "sueldo" };
  // Paga extraordinaria de junio o diciembre ("PAGA EXTRA", "P.EXTRA JUNIO",
  // "PAGA EXTRAORDINARIA"...): es parte de la nomina base, no un concepto raro.
  if (/EXTRA/.test(n) && !/PRORRATA/.test(n)) return { tipo: "extra" };
  return { tipo: "otro" };
}

function clasificarDescuento(nombre) {
  const n = nombre.toUpperCase();
  if (/I\.?\s*R\.?\s*P\.?\s*F/.test(n)) return "irpf";
  if (/COTIZ|DESEMPLEO|FORMACI/.test(n)) return "cotizacion";
  return "otro";
}

const euros = (n) => `${n.toFixed(2).replace(".", ",")} €`;

// Devuelve { nomina, avisos }. `nomina` lleva los campos de siempre (periodo,
// clase, bruto, neto, cotizacion, irpf) y, si la tabla de conceptos se ha
// podido leer y cuadra al céntimo con los totales, un `desglose` opcional.
// Los `avisos` son para la tarjeta de revisión: no se guardan.
export function parsearNomina(texto) {
  const avisos = [];
  const [, tipoEmision] = capturar(
    texto, /Tip\.n[oó]m\.emisi[oó]n:\s*(\S+)/i, "Tip.nóm.emisión");

  const [, diaIni, mes, anio, diaFin, mesFin, anioFin] = capturar(
    texto,
    /Periodo liquidaci[oó]n:\s*(\d{2})\/(\d{2})\/(\d{4})\s*al\s*(\d{2})\/(\d{2})\/(\d{4})/i,
    "Periodo liquidación");
  // El mes al que se imputa lo dice el propio SAS en "Fecha afectación"; si
  // faltara, el del inicio del periodo liquidado.
  const afectacion = texto.match(/Fecha afectaci[oó]n:\s*(\d{4})-(\d{2})/i);
  const periodo = afectacion ? `${afectacion[1]}-${afectacion[2]}` : `${anio}-${mes}`;
  if (mes !== mesFin || anio !== anioFin) {
    avisos.push(`Liquida del ${diaIni}/${mes}/${anio} al ${diaFin}/${mesFin}/${anioFin}, `
      + `más de un mes: la registro en ${periodo}. Cámbialo si no es ese.`);
  }

  const [, brutoTexto] = capturar(texto, /Total devengos:\s*([\d.,]+)/i, "Total devengos");
  const [, descuentosTexto] = capturar(
    texto, /Total descuentos:\s*([\d.,]+)/i, "Total descuentos");
  const [, netoTexto] = capturar(
    texto, /L[ií]quido a percibir:\s*([\d.,]+)/i, "Líquido a percibir");
  const bruto = numero(brutoTexto);
  const totalDescuentos = numero(descuentosTexto);
  const neto = numero(netoTexto);

  const lineas = celdas(texto);
  const tabla = tramo(lineas, (l) => l === "Descuentos", (l) => /^Total devengos:/i.test(l));
  const grupos = tabla.length ? leerGrupos(tabla) : null;
  const suma = (lista) => r2(lista.reduce((s, x) => s + x.importe, 0));
  const cuadra = Boolean(grupos)
    && Math.abs(suma(grupos.devengos) - bruto) <= 0.02
    && Math.abs(suma(grupos.descuentos) - totalDescuentos) <= 0.02;

  let clase = CLASE_POR_EMISION[tipoEmision];
  // Sin desglose legible se supone lo de siempre: todo el descuento es
  // cotización. La tarjeta de revisión avisa para que se corrija a mano.
  let cotizacion = totalDescuentos;
  let irpf = 0;
  let desglose = null;

  if (!cuadra) {
    avisos.push("No he podido leer la tabla de conceptos: se guardan solo los totales. "
      + "Revisa la cotización y el IRPF con el PDF delante.");
  } else {
    const precios = leerImportesUnitarios(lineas);
    const horas = { laborable: 0, sdf: 0, especial: 0 };
    const importes = { laborable: 0, sdf: 0, especial: 0 };
    let prorrata = 0;
    let pagaExtra = 0;
    const preciosHora = {};
    let horasDesconocidas = false;
    const otros = [];
    for (const d of grupos.devengos) {
      const c = clasificarDevengo(d.nombre);
      if (c.tipo === "guardia") {
        importes[c.dia] = r2(importes[c.dia] + d.importe);
        const precio = precios[d.clave];
        if (precio > 0) preciosHora[c.dia] = precio;
        if (precio > 0) horas[c.dia] = r2(horas[c.dia] + d.importe / precio);
        else {
          horasDesconocidas = true;
          avisos.push(`No sé cuántas horas son los ${euros(d.importe)} de "${d.nombre}": `
            + "no podré compararla con tu calendario.");
        }
      } else if (c.tipo === "prorrata") {
        prorrata = r2(prorrata + d.importe);
      } else if (c.tipo === "extra") {
        pagaExtra = r2(pagaExtra + d.importe);
      } else if (c.tipo === "otro") {
        otros.push({ nombre: d.nombre, importe: d.importe });
        avisos.push(`Concepto que no conozco: "${d.nombre}" (${euros(d.importe)}). `
          + "Cuenta en el bruto, pero no como guardia.");
      }
    }
    const otrosDescuentos = [];
    cotizacion = 0;
    for (const d of grupos.descuentos) {
      const tipo = clasificarDescuento(d.nombre);
      if (tipo === "irpf") irpf = r2(irpf + d.importe);
      else if (tipo === "cotizacion") cotizacion = r2(cotizacion + d.importe);
      else {
        otrosDescuentos.push({ nombre: d.nombre, importe: d.importe });
        avisos.push(`Descuento que no es cotización ni IRPF: "${d.nombre}" (${euros(d.importe)}).`);
      }
    }
    const brutoGuardias = r2(importes.laborable + importes.sdf + importes.especial);
    if (!clase) {
      clase = brutoGuardias + prorrata > 0 ? "guardias" : "base";
      avisos.push(`Tipo de nómina "${tipoEmision}": por sus conceptos la registro como `
        + `${clase === "guardias" ? "de guardias" : "base"}. Cámbialo si no es así.`);
    }

    desglose = {
      liquidacion: { desde: `${anio}-${mes}-${diaIni}`, hasta: `${anioFin}-${mesFin}-${diaFin}` },
    };
    if (brutoGuardias > 0) {
      // Unas horas a medias (0 donde no se supo el precio) harian que el
      // contraste con el calendario diera una diferencia falsa: o todas o ninguna.
      if (!horasDesconocidas) desglose.horas = horas;
      if (Object.keys(preciosHora).length) desglose.precios = preciosHora;
      desglose.guardias = brutoGuardias;
    }
    if (prorrata > 0) desglose.prorrataVacaciones = prorrata;
    if (pagaExtra > 0) desglose.pagaExtra = pagaExtra;
    // "Días afectados": las celdas vacías no salen en el texto, así que el
    // número de días solo se asigna si hay uno por código o, si falta alguno,
    // cuando Vacaciones es la primera fila y la nómina trae prorrata de
    // vacaciones (así es la complementaria real: VD con días y LI vacía).
    const dias = tramo(lineas, (l) => /^D[ií]as afectados$/i.test(l), (l) => l === "Cotizaciones");
    const codigos = dias.filter((l) => /^[A-Z]{2}$/.test(l));
    const numeros = dias.filter((l) => /^\d+$/.test(l));
    const k = codigos.indexOf("VD");
    if (k >= 0 && (numeros.length === codigos.length
        || (k === 0 && numeros.length === 1 && prorrata > 0))) {
      desglose.diasVacaciones = Number(numeros[k]);
    }
    if (otros.length) desglose.otros = otros;
    if (otrosDescuentos.length) desglose.otrosDescuentos = otrosDescuentos;
  }
  if (!clase) {
    throw new Error(`Tipo de nómina no reconocido ("${tipoEmision}") y sin conceptos legibles: regístrala a mano.`);
  }

  const nomina = { periodo, clase, bruto, neto, cotizacion, irpf };
  if (desglose) nomina.desglose = desglose;
  return { nomina, avisos };
}
