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
  localStorage.setItem("peday_email", email);
  return tok;
}
function logout() { TOKEN = ""; ["peday_token", "peday_auth"].forEach(k => localStorage.removeItem(k)); }
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

const peday = {
  ENVS, setEnv, envName, login, logout, isAuthed, apiGet, fetchAll, SUCCESS,
  merchants: () => apiGet("/api/v1/admin/merchants").then(d => d.CONTENT || d),
  payins: (from, to) => fetchAll("/api/v1/admin/payin-intents", { from, to }),
  payouts: (from, to) => fetchAll("/api/v1/admin/payouts", { from, to }),
  ledger: (m) => apiGet(`/api/v1/admin/wallets/merchant/${m}/transactions`).then(d => Array.isArray(d) ? d : (d.CONTENT || d)),
  get email() { return localStorage.getItem("peday_email") || ""; },
};
window.peday = peday;
