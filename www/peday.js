/* Peday API client — talks to the peday/spark dashboard DIRECTLY from the app.
   Works in the native app (Capacitor) which is not subject to browser CORS.
   The logged-in user's own token is used; nothing is hardcoded. */
const ENVS = {
  peday: "https://dashboard.peday.money",
  spark: "https://dashboard.sparkpay.in",
};
let BASE = localStorage.getItem("peday_base") || ENVS.peday;
let TOKEN = localStorage.getItem("peday_token") || "";
const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "CREDITED"]);

function setEnv(name) { BASE = ENVS[name] || ENVS.peday; localStorage.setItem("peday_base", BASE); }
function envName() { return BASE === ENVS.spark ? "spark" : "peday"; }

async function login(email, password) {
  const r = await fetch(BASE + "/api/v1/auth/admin/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  const tok = d.ACCESSTOKEN || d.accessToken;
  if (!r.ok || !tok) throw new Error(d.MESSAGE || d.message || "Invalid credentials");
  TOKEN = tok; localStorage.setItem("peday_token", tok);
  // Remember credentials on this device for auto sign-in (base64, per-device).
  localStorage.setItem("peday_email", email);
  try { localStorage.setItem("peday_pw", btoa(unescape(encodeURIComponent(password)))); } catch (e) {}
  return tok;
}
function savedCreds() {
  const email = localStorage.getItem("peday_email") || "";
  let pw = ""; try { pw = decodeURIComponent(escape(atob(localStorage.getItem("peday_pw") || ""))); } catch (e) {}
  return { email, pw };
}
// logout keeps the token; "forget" clears saved credentials too.
function logout() { TOKEN = ""; ["peday_token", "peday_auth"].forEach(k => localStorage.removeItem(k)); }
function forget() { logout(); ["peday_email", "peday_pw"].forEach(k => localStorage.removeItem(k)); }
function isAuthed() { return !!TOKEN; }

async function apiGet(path, params) {
  const url = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => v !== "" && v != null && url.searchParams.set(k, v));
  const r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN, Accept: "application/json" } });
  if (r.status === 401) throw new Error("Session expired — sign in again");
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Walk every page of a CONTENT-wrapped list endpoint.
async function fetchAll(path, params) {
  const out = []; let page = 0;
  for (let i = 0; i < 200; i++) {
    const d = await apiGet(path, { ...params, page, size: 5000 });
    const rows = Array.isArray(d) ? d : (d.CONTENT || d.content || []);
    out.push(...rows);
    const total = d.TOTALPAGES ?? d.totalPages;
    const last = d.LAST ?? d.last;
    if (last === true || (total != null && page >= total - 1) || rows.length < 5000) break;
    page++;
  }
  return out;
}

// Incremental fetch: the API is newest-first, so new records are a prefix.
// Walk pages collecting records until we hit one already in `seen`, then stop.
async function fetchNew(path, from, to, seen) {
  const out = []; let page = 0;
  for (let i = 0; i < 20; i++) {
    const d = await apiGet(path, { from, to, page, size: 500 });
    const rows = Array.isArray(d) ? d : (d.CONTENT || d.content || []);
    let hitSeen = false;
    for (const r of rows) {
      const id = r.GATEWAYTRANSACTIONID;
      if (id && seen.has(id)) { hitSeen = true; break; }
      out.push(r);
    }
    if (hitSeen || rows.length < 500) break;
    page++;
  }
  return out;
}

const peday = {
  ENVS, setEnv, envName, login, logout, forget, isAuthed, savedCreds, apiGet, fetchAll, fetchNew, SUCCESS,
  PAYIN_PATH: "/api/v1/admin/payin-intents",
  PAYOUT_PATH: "/api/v1/admin/payouts",
  merchants: () => apiGet("/api/v1/admin/merchants").then(d => d.CONTENT || d),
  payins: (from, to) => fetchAll("/api/v1/admin/payin-intents", { from, to }),
  payouts: (from, to) => fetchAll("/api/v1/admin/payouts", { from, to }),
  ledger: (m) => apiGet(`/api/v1/admin/wallets/merchant/${m}/transactions`).then(d => Array.isArray(d) ? d : (d.CONTENT || d)),
  get email() { return localStorage.getItem("peday_email") || ""; },
};
window.peday = peday;
