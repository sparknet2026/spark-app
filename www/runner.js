/* Background task — runs even when the app is closed/backgrounded (Android ~15 min
   min interval, we request 10). It has its own limited JS context: no DOM, no
   localStorage; only fetch, CapacitorKV (shared key store), CapacitorNotifications.

   The app seeds credentials into CapacitorKV via the "saveCreds" event; this task
   reads them, logs in fresh (the token lives only 15 min), fetches today's txns,
   runs a compact risk check, and fires a notification if anything is flagged. */

addEventListener("saveCreds", (resolve, reject, args) => {
  try {
    CapacitorKV.set("base", (args && args.base) || "");
    CapacitorKV.set("email", (args && args.email) || "");
    CapacitorKV.set("pw", (args && args.pw) || "");
    resolve();
  } catch (e) { reject(e); }
});

const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
const dayOf = r => { const m = String(r.TRANSACTIONTIMESTAMP || r.CREATEDAT || r.CREATEDDATE || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : ""; };
const hourOf = r => { const m = String(r.TRANSACTIONTIMESTAMP || r.CREATEDAT || r.CREATEDDATE || "").match(/[T ](\d{1,2}):/); return m ? +m[1] : null; };

// Compact risk scan — returns the flag count (default thresholds).
function riskCount(payins, payouts) {
  const T = [];
  (payins || []).forEach(r => T.push(mk(r, "Payin")));
  (payouts || []).forEach(r => T.push(mk(r, "Payout")));
  function mk(r, mode) {
    return { mode, vendor: r.MERCHANTCODE || "", account: String(r.ACCOUNTNUMBER || "").trim(),
      mobile: String(r.CUSTOMERMOBILENUMBER || "").trim(),
      vpa: String(r.PAYERVPA || r.CUSTOMERVPA || "").trim(),
      amount: num(r.APPROVEDAMOUNT), status: String(r.PAYMENTSTATUS || r.TXNSTATUS || "").toUpperCase(),
      day: dayOf(r), hour: hourOf(r) };
  }
  const SUCCESS = new Set(["SUCCESS", "SUCCESSFUL", "COMPLETED", "CREDITED"]);
  const S = T.filter(t => SUCCESS.has(t.status));   // all rules run on successful txns
  const grp = (keyFn) => { const g = {}; S.forEach(t => { const k = keyFn(t); if (k == null) return; (g[k] = g[k] || []).push(t); }); return g; };
  const sum = a => a.reduce((s, t) => s + t.amount, 0);
  let n = 0;
  // same account: >=5 txns or >= 200000/day
  Object.values(grp(t => t.account ? t.account + "|" + t.day : null)).forEach(a => { if (a.length >= 5 || sum(a) >= 200000) n++; });
  // same mobile: >=10/day
  Object.values(grp(t => t.mobile ? t.mobile + "|" + t.day : null)).forEach(a => { if (a.length >= 10) n++; });
  // same UPI: >=3 on one VPA in a day
  Object.values(grp(t => t.vpa ? t.vpa + "|" + t.day : null)).forEach(a => { if (a.length >= 3) n++; });
  // high value: single >= 50000
  S.forEach(t => { if (t.amount >= 50000) n++; });
  // after hours 1-5
  Object.values(grp(t => (t.hour != null && t.hour >= 1 && t.hour < 5) ? t.vendor + "|" + t.day : null)).forEach(() => n++);
  // repeated failure: entity failing > 5 times in a day (per mode) — uses all txns
  const FAILED = new Set(["FAILED", "FAILURE", "DECLINED", "REJECTED"]);
  const gf = {};
  T.forEach(t => { if (!FAILED.has(t.status)) return; const e = t.account || t.mobile || t.vpa; if (!e) return; const k = e + "|" + t.mode + "|" + t.day; gf[k] = (gf[k] || 0) + 1; });
  Object.values(gf).forEach(c => { if (c > 5) n++; });
  return n;
}

addEventListener("periodicRisk", async (resolve, reject) => {
  try {
    const base = (CapacitorKV.get("base") || {}).value;
    const email = (CapacitorKV.get("email") || {}).value;
    const pw = (CapacitorKV.get("pw") || {}).value;
    if (!base || !email || !pw) { resolve(); return; }

    const lr = await fetch(base + "/api/v1/auth/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    const ld = await lr.json();
    const tok = ld.ACCESSTOKEN || ld.accessToken;
    if (!tok) { resolve(); return; }
    const H = { Authorization: "Bearer " + tok, Accept: "application/json" };
    const today = new Date().toISOString().slice(0, 10);

    async function fetchAll(path) {
      let out = [], page = 0;
      for (let i = 0; i < 10; i++) {
        const r = await fetch(`${base}${path}?from=${today}&to=${today}&page=${page}&size=5000`, { headers: H });
        const d = await r.json();
        const rows = d.CONTENT || d.content || [];
        out = out.concat(rows);
        if (d.LAST || rows.length < 5000) break;
        page++;
      }
      return out;
    }
    const payins = await fetchAll("/api/v1/admin/payin-intents");
    const payouts = await fetchAll("/api/v1/admin/payouts");
    const n = riskCount(payins, payouts);
    if (n > 0) {
      CapacitorNotifications.schedule([{
        id: Math.floor(Date.now() % 100000),
        title: "⚠ Risk alert",
        body: n + " transaction(s) flagged today",
      }]);
    }
    resolve();
  } catch (e) { reject(e); }
});
