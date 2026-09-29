import S from "./estado.js";
export function getFirestore() { return {}; }
export function doc(db, col, id) { return { col, id }; }
export async function getDoc(ref) {
  S.lecturas.push(ref.id);
  if (S.falloLectura) throw new Error("sin red");
  const d = S.docs[ref.id];
  return { exists: () => d !== undefined, data: () => structuredClone(d) };
}
export async function setDoc(ref, data) {
  if (JSON.stringify(data).includes("undefined")) throw new Error("undefined");
  S.escrituras.push({ uid: ref.id, data: structuredClone(data) });
  S.docs[ref.id] = structuredClone(data);
}
