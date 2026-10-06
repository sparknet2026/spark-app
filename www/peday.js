/* Peday API client — talks to the peday/spark dashboard DIRECTLY from the app.
   Works in the native app (Capacitor) which is not subject to browser CORS.
   The logged-in user's own token is used; nothing is hardcoded. */
const ENVS = {
  spark: "https://dashboard.sparkpay.in",
};
// Single environment: Spark. (The old Peday host was retired.) Any stale
// peday_base saved by an older build is ignored so it can't resurrect it.
let BASE = ENVS.spark;
let TOKEN = localStorage.getItem("peday_token") || "";
const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "CREDITED"]);

function setEnv() { BASE = ENVS.spark; localStorage.setItem("peday_base", BASE); }
function envName() { return "spark"; }

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

async function apiGet(path, params, _retry) {
  const url = new URL(BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => v !== "" && v != null && url.searchParams.set(k, v));
  // Timeout so one slow/hung call can't freeze the whole load (the app would
  // otherwise sit on the splash and look like it "won't open").
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try { r = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN, Accept: "application/json" }, signal: ctrl.signal }); }
  catch (e) { throw new Error(e.name === "AbortError" ? "Request timed out — check connection" : e.message); }
  finally { clearTimeout(t); }
  if (r.status === 401) {
    // Token lives only 15 min — silently re-login with saved creds and retry once.
    if (!_retry) {
      const c = savedCreds();
      if (c.email && c.pw) { try { await login(c.email, c.pw); return apiGet(path, params, true); } catch (e) {} }
    }
    throw new Error("Session expired — sign in again");
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Walk every page of a CONTENT-wrapped list endpoint.
// Fetch page 0 first to learn the page count, then pull the rest in parallel
// (capped) instead of one-at-a-time — a big-day load that was ~4 sequential
// round trips becomes ~2, so the dashboard shows all data much sooner.
const PAGE_SIZE = 10000, MAX_CONCURRENT = 5;
const _rowsOf = d => Array.isArray(d) ? d : (d.CONTENT || d.content || []);

async function fetchAll(path, params) {
  const first = await apiGet(path, { ...params, page: 0, size: PAGE_SIZE });
  const out = _rowsOf(first);
  const total = first.TOTALPAGES ?? first.totalPages;

  // No page-count header, or everything fit on page 0 → done / sequential fallback.
  if (total == null) {
    if (out.length < PAGE_SIZE) return out;
    let page = 1;
    for (let i = 0; i < 200; i++) {
      const r = _rowsOf(await apiGet(path, { ...params, page, size: PAGE_SIZE }));
      out.push(...r);
      if (r.length < PAGE_SIZE) break; page++;
    }
    return out;
  }
  if (total <= 1) return out;

  // Remaining pages in parallel, in capped batches to avoid hammering the API.
  const pages = [];
  for (let p = 1; p < total; p++) pages.push(p);
  for (let i = 0; i < pages.length; i += MAX_CONCURRENT) {
    const batch = pages.slice(i, i + MAX_CONCURRENT);
    const res = await Promise.all(batch.map(p => apiGet(path, { ...params, page: p, size: PAGE_SIZE })));
    res.forEach(d => out.push(..._rowsOf(d)));
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

// ---- Salora panel (separate system: LSP payin/payout wallets by company) ----
// Independent host, its own (currently open) API — NOT tied to the peday/spark login.
const SALORA = "https://panel.saloracapital.com";
async function sget(path, params) {
  const url = new URL(SALORA + path);
  Object.entries(params || {}).forEach(([k, v]) => v != null && v !== "" && url.searchParams.set(k, v));
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
const salora = {
  BASE: SALORA,
  collectionCompanies: () => sget("/api/v1/collection/wallet-companies").then(d => d.companies || []),
  payoutCompanies: () => sget("/api/v1/payout/wallet-companies").then(d => d.companies || []),
  collectionWallet: (name) => sget("/api/v1/collection/wallet", { company_name: name }),
  payoutWallet: (name) => sget("/api/v1/payout/wallet", { company_name: name }),
};

const peday = {
  ENVS, setEnv, envName, login, logout, forget, isAuthed, savedCreds, apiGet, fetchAll, fetchNew, SUCCESS, salora,
  PAYIN_PATH: "/api/v1/admin/payin-intents",
  PAYOUT_PATH: "/api/v1/admin/payouts",
  merchants: () => apiGet("/api/v1/admin/merchants").then(d => d.CONTENT || d),
  payins: (from, to) => fetchAll("/api/v1/admin/payin-intents", { from, to }),
  payouts: (from, to) => fetchAll("/api/v1/admin/payouts", { from, to }),
  ledger: (m) => apiGet(`/api/v1/admin/wallets/merchant/${m}/transactions`).then(d => Array.isArray(d) ? d : (d.CONTENT || d)),
  ledgerAll: (m) => fetchAll(`/api/v1/admin/wallets/merchant/${m}/transactions`, {}),
  balance: (m) => apiGet(`/api/v1/admin/wallets/merchant/${m}`),
  // Per-merchant daily volume (SUCCESSAMOUNT) — one light call per date.
  dailyByMerchant: (mode, date) => apiGet(`/api/v1/admin/dashboard/${mode}/commission`, { date }).then(d => Array.isArray(d) ? d : (d.CONTENT || [])),
  get email() { return localStorage.getItem("peday_email") || ""; },
};
window.peday = peday;
