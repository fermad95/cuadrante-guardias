// Firebase simulado: todo el estado en window.__FB, sembrable desde sessionStorage.
const ini = JSON.parse(sessionStorage.getItem("__FB_init") || "{}");
const S = window.__FB || (window.__FB = {
  user: ini.user || null, docs: ini.docs || {}, subs: [], escrituras: [], lecturas: [], falloLectura: !!ini.falloLectura,
});
S.login = (uid, email) => { S.user = { uid, email, displayName: email, photoURL: null }; S.subs.forEach((f) => f(S.user)); };
S.logout = () => { S.user = null; S.subs.forEach((f) => f(null)); };
export default S;
