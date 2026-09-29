import S from "./estado.js";
export function getAuth() { return { get currentUser() { return S.user; } }; }
export function onAuthStateChanged(auth, cb) { S.subs.push(cb); setTimeout(() => cb(S.user), 0); return () => {}; }
export function getRedirectResult() { return Promise.resolve(null); }
export class GoogleAuthProvider {}
export async function signInWithPopup() {}
export async function signInWithRedirect() {}
export async function signOut() { S.logout(); }
