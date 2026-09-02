function partes(fechaISO) {
  const [a, m, d] = fechaISO.split("-").map(Number);
  return { a, m, d };
}

function texto(a, m, d) {
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function diaSemana(fechaISO) {
  const { a, m, d } = partes(fechaISO);
  return new Date(a, m - 1, d).getDay();
}

export function desplazar(fechaISO, dias) {
  const { a, m, d } = partes(fechaISO);
  const x = new Date(a, m - 1, d + dias);
  return texto(x.getFullYear(), x.getMonth() + 1, x.getDate());
}

export function diaSiguiente(fechaISO) {
  return desplazar(fechaISO, 1);
}

export function aMinutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function aHora(minutos) {
  const dias = Math.floor(minutos / 1440);
  const resto = minutos - dias * 1440;
  if (resto === 0 && dias > 0) {
    return dias === 1 ? "24:00" : `24:00 +${dias - 1}`;
  }
  const h = String(Math.floor(resto / 60)).padStart(2, "0");
  const m = String(resto % 60).padStart(2, "0");
  return dias > 0 ? `${h}:${m} +${dias}` : `${h}:${m}`;
}

export function mesDe(fechaISO) {
  return fechaISO.slice(0, 7);
}

export function diasDelMes(anioMes) {
  const [a, m] = anioMes.split("-").map(Number);
  const cuantos = new Date(a, m, 0).getDate();
  return Array.from({ length: cuantos }, (_, i) => texto(a, m, i + 1));
}

export function redondear(n) {
  return Math.round(n * 100) / 100;
}
