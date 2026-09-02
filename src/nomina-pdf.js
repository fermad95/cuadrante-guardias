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

export async function extraerTextoPdf(arrayBuffer) {
  const pdfjs = await cargarPdfjs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pagina = await doc.getPage(1);
  const contenido = await pagina.getTextContent();
  return contenido.items.map((it) => it.str).join(" ");
}

// El SAS solo emite estos dos tipos para un residente: la nómina Normal (el
// sueldo fijo del mes) y la Complementaria (liquidación de guardias del mes
// anterior). Cualquier otro valor se rechaza en vez de adivinar la clase.
const CLASE_POR_EMISION = { Normal: "base", Complementaria: "guardias" };

function numero(texto) {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

function capturar(texto, patron, etiqueta) {
  const m = texto.match(patron);
  if (!m) throw new Error(`No se encontró "${etiqueta}" en el PDF.`);
  return m;
}

export function parsearNomina(texto) {
  const [, tipoEmision] = capturar(
    texto, /Tip\.n[oó]m\.emisi[oó]n:\s*(\S+)/i, "Tip.nóm.emisión");
  const clase = CLASE_POR_EMISION[tipoEmision];
  if (!clase) throw new Error(`Tipo de nómina no reconocido: "${tipoEmision}".`);

  const [, diaIni, mes, anio, diaFin, mesFin, anioFin] = capturar(
    texto,
    /Periodo liquidaci[oó]n:\s*(\d{2})\/(\d{2})\/(\d{4})\s*al\s*(\d{2})\/(\d{2})\/(\d{4})/i,
    "Periodo liquidación");
  // Todas las nominas reales vistas hasta ahora liquidan un mes natural
  // completo. Si algun dia el SAS emite un periodo partido entre dos meses
  // (p.ej. un alta o baja a mitad de mes), no hay forma fiable de decidir
  // solo el aqui a que mes natural pertenece — mejor rechazarlo y que se
  // registre a mano, con criterio, que adivinar.
  if (mes !== mesFin || anio !== anioFin) {
    throw new Error(
      `El periodo de liquidación (${diaIni}/${mes}/${anio} al ${diaFin}/${mesFin}/${anioFin}) `
      + "no cae en un solo mes natural: regístrala a mano.");
  }
  const periodo = `${anio}-${mes}`;

  const [, brutoTexto] = capturar(texto, /Total devengos:\s*([\d.,]+)/i, "Total devengos");
  const [, descuentosTexto] = capturar(
    texto, /Total descuentos:\s*([\d.,]+)/i, "Total descuentos");
  const [, netoTexto] = capturar(
    texto, /L[ií]quido a percibir:\s*([\d.,]+)/i, "Líquido a percibir");

  // Hasta la primera regularización del residente el IRPF es 0 y el total de
  // descuentos es íntegro cotización (así en todas las nóminas reales vistas
  // hasta ahora). Si algún mes deja de ser así, el paso de revisión antes de
  // guardar (en la UI) es donde se corrige a mano, igual que en el alta
  // manual — no hace falta adivinarlo aquí.
  return {
    periodo, clase,
    bruto: numero(brutoTexto),
    neto: numero(netoTexto),
    cotizacion: numero(descuentosTexto),
    irpf: 0,
  };
}
