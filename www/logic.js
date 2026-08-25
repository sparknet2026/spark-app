/* Commission + Risk engines — ported from the Python backend to run in the app.
   All computation happens on-device from data fetched directly off peday. */

const num = v => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(n) ? 0 : n; };
const localDate = v => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/) || String(v || "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (!m) return ""; return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; };
const hourOf = v => { const m = String(v || "").match(/[T ](\d{1,2}):/); return m ? +m[1] : null; };

// ---- Merchant commission config -> {code:{name,partner,payin:{...},payout:{...}}} ----
function merchantRates(list) {
  const out = {};
  (list || []).forEach(m => {
    if (!m.MERCHANTCODE) return;
    out[m.MERCHANTCODE] = { name: m.MERCHANTNAME || "", partner: m.PARTNERCODE || "",
      payin: m.PAYINCOMMISSION || {}, payout: m.PAYOUTCOMMISSION || {} };
  });
  return out;
}
function applyRate(cfg, amount, txns) {
  if (!cfg || !Object.keys(cfg).length) return { commission: 0, gst: 0, total: 0, label: "n/a" };
  const type = String(cfg.TYPE || "PERCENT").toUpperCase(), val = num(cfg.VALUE),
        gstR = num(cfg.GSTRATE), treat = String(cfg.GSTTREATMENT || "EXCLUSIVE").toUpperCase();
  let commission, label;
  if (type === "FLAT") { commission = round2(val * txns); label = `FLAT ${val}/txn`; }
  else { commission = round2(amount * val / 100); label = `${val}%`; }
  let gst = 0, total = commission;
  if (treat === "EXCLUSIVE") { gst = round2(commission * gstR / 100); total = round2(commission + gst); }
  else if (treat === "INCLUSIVE") { const base = round2(commission / (1 + gstR / 100)); gst = round2(commission - base); commission = base; }
  return { commission, gst, total, label, treatment: treat.charAt(0) + treat.slice(1).toLowerCase() };
}
const round2 = n => Math.round(n * 100) / 100;
const dayOf = r => localDate(r.TRANSACTIONTIMESTAMP || r.CREATEDAT || r.CREATEDDATE);
const statusOf = r => String(r.PAYMENTSTATUS || r.TXNSTATUS || "").toUpperCase();

// ---- Vendor commission: Date x Vendor x Mode ----
function vendorCommission(payins, payouts, rates) {
  const rows = [];
  [["Payin", payins], ["Payout", payouts]].forEach(([mode, recs]) => {
    const agg = {};
    (recs || []).forEach(r => {
      if (!peday.SUCCESS.has(statusOf(r))) return;
      const day = dayOf(r); if (!day) return;
      const code = r.MERCHANTCODE || "", k = code + "|" + day;
      (agg[k] = agg[k] || { code, day, txns: 0, amt: 0 });
      agg[k].txns++; agg[k].amt += num(r.APPROVEDAMOUNT);
    });
    Object.values(agg).forEach(a => {
      const info = rates[a.code] || {}, res = applyRate(info[mode.toLowerCase()], a.amt, a.txns);
      rows.push({ Date: a.day, Vendor: a.code, VendorName: info.name || "", Mode: mode, Txns: a.txns,
        Base: round2(a.amt), Rate: res.label, Treatment: res.treatment || "n/a",
        Commission: res.commission, GST: res.gst, Total: res.total });
    });
  });
  return rows.sort((x, y) => (x.Date + x.Vendor).localeCompare(y.Date + y.Vendor));
}

// ---- Risk engine (9 rules) ----
const DEFAULT_RULES = {
  same_account: { enabled: true, max_txns_per_day: 5, max_amount_per_day: 200000, severity: "high" },
  same_mobile: { enabled: true, max_txns_per_day: 10, severity: "medium" },
  same_upi: { enabled: true, max_txns_per_day: 3, severity: "high" },
  volume_spike: { enabled: true, pct_above_avg: 50, min_baseline_days: 3, severity: "high" },
  after_hours: { enabled: true, start_hour: 1, end_hour: 5, severity: "medium" },
  high_value_txn: { enabled: true, min_amount: 50000, severity: "medium" },
  structuring: { enabled: true, band_min: 45000, band_max: 50000, min_txns: 2, severity: "high" },
  high_failure_rate: { enabled: true, min_txns: 20, max_fail_ratio: 0.5, severity: "medium" },
  round_amount: { enabled: true, multiple_of: 10000, min_txns: 5, severity: "low" },
};
function getRules() { try { return JSON.parse(localStorage.getItem("peday_rules")) || DEFAULT_RULES; } catch (e) { return DEFAULT_RULES; } }
function saveRules(r) { localStorage.setItem("peday_rules", JSON.stringify(r)); }

function norm(r, mode) {
  return { mode, vendor: r.MERCHANTCODE || "", account: String(r.ACCOUNTNUMBER || "").trim(),
    mobile: String(r.CUSTOMERMOBILENUMBER || "").trim(), name: String(r.CUSTOMERNAME || r.PAYERNAME || "").trim(),
    vpa: String(r.PAYERVPA || r.CUSTOMERVPA || "").trim(),
    amount: num(r.APPROVEDAMOUNT), status: statusOf(r), day: dayOf(r), hour: hourOf(r.TRANSACTIONTIMESTAMP || r.CREATEDAT || r.CREATEDDATE),
    ts: String(r.TRANSACTIONTIMESTAMP || r.CREATEDAT || r.CREATEDDATE || ""),
    txn: r.GATEWAYTRANSACTIONID || "" };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function riskScan(payins, payouts, rules) {
  rules = rules || getRules();
  let txns = [...(payins || []).map(r => norm(r, "Payin")), ...(payouts || []).map(r => norm(r, "Payout"))].filter(t => t.day);
  if (rules.success_only) txns = txns.filter(t => peday.SUCCESS.has(t.status));
  const flags = [];
  const tmax = a => a.reduce((m, t) => (t.ts > m ? t.ts : m), "");
  const add = (rule, entity, mode, day, count, amount, detail, sev, arr) => {
    arr = arr || [];
    flags.push({ Rule: rule, Entity: entity,
      Merchant: [...new Set(arr.map(t => t.vendor))].filter(Boolean).join(", "),
      Mode: mode || "", Date: day || "", Count: count, Amount: round2(amount),
      TxnIDs: arr.map(t => t.txn).filter(Boolean).slice(0, 5).join(", "),
      Time: tmax(arr) || (day || ""),
      Rows: arr.map(t => ({ id: t.txn, amount: round2(t.amount), name: t.name, account: t.account, mobile: t.mobile, mode: t.mode, status: t.status, time: t.ts })),
      Detail: detail, Severity: cap(sev) });
  };
  const group = (keyFn) => { const g = {}; txns.forEach(t => { const k = keyFn(t); if (k == null) return; (g[k] = g[k] || []).push(t); }); return g; };
  const sum = a => a.reduce((s, t) => s + t.amount, 0);

  let r = rules.same_account;
  if (r?.enabled) Object.entries(group(t => t.account ? t.account + "|" + t.day : null)).forEach(([k, a]) => {
    const c = a.length, amt = sum(a), hc = c >= r.max_txns_per_day, ha = amt >= r.max_amount_per_day;
    if (hc || ha) add("Same account", k.split("|")[0], [...new Set(a.map(t=>t.mode))].join("/"), a[0].day, c, amt,
      `${c} txns totalling ${amt.toLocaleString()} in one day`, (hc && ha) ? "high" : r.severity, a);
  });

  r = rules.same_mobile;
  if (r?.enabled) Object.entries(group(t => t.mobile ? t.mobile + "|" + t.day : null)).forEach(([k, a]) => {
    if (a.length >= r.max_txns_per_day) add("Same mobile", k.split("|")[0], "", a[0].day, a.length, sum(a),
      `mobile used in ${a.length} txns in one day`, r.severity, a);
  });

  r = rules.same_upi;
  if (r?.enabled) Object.entries(group(t => (t.vpa && peday.SUCCESS.has(t.status)) ? t.vpa + "|" + t.day : null)).forEach(([k, a]) => {
    if (a.length >= r.max_txns_per_day) add("Same UPI", k.split("|")[0], "", a[0].day, a.length, sum(a),
      `UPI used in ${a.length} successful txns in one day`, r.severity, a);
  });

  r = rules.volume_spike;
  if (r?.enabled) { const by = {};
    txns.forEach(t => { const k = t.vendor + "|" + t.mode; (by[k] = by[k] || {}); (by[k][t.day] = by[k][t.day] || []).push(t); });
    Object.entries(by).forEach(([k, days]) => { const ds = Object.keys(days); if (ds.length < r.min_baseline_days) return;
      ds.forEach(day => { const arr = days[day], c = arr.length, others = ds.filter(d => d !== day).map(d => days[d].length);
        if (!others.length) return; const avg = others.reduce((s, x) => s + x, 0) / others.length;
        if (avg > 0 && c >= avg * (1 + r.pct_above_avg / 100)) { const j = (c / avg - 1) * 100;
          add("Volume spike", k.replace("|", " · "), k.split("|")[1], day, c, sum(arr),
            `${c} txns vs avg ${avg.toFixed(0)} (+${j.toFixed(0)}%)`, j >= 100 ? "high" : r.severity, arr); } }); });
  }

  r = rules.after_hours;
  if (r?.enabled) Object.entries(group(t => (t.hour != null && t.hour >= r.start_hour && t.hour < r.end_hour) ? t.vendor + "|" + t.day : null))
    .forEach(([k, a]) => add("After hours", k.split("|")[0], "", a[0].day, a.length, sum(a),
      `${a.length} txns between ${String(r.start_hour).padStart(2,"0")}:00-${String(r.end_hour).padStart(2,"0")}:00`, r.severity, a));

  r = rules.high_value_txn;
  if (r?.enabled) txns.filter(t => t.amount >= r.min_amount).forEach(t =>
    add("High-value txn", t.account || t.mobile || t.name || t.vendor, t.mode, t.day, 1, t.amount,
      `single ${t.mode.toLowerCase()} of ${t.amount.toLocaleString()}`, r.severity, [t]));

  r = rules.structuring;
  if (r?.enabled) Object.entries(group(t => { const e = t.account || t.mobile; return (e && t.amount >= r.band_min && t.amount < r.band_max) ? e + "|" + t.day : null; }))
    .forEach(([k, a]) => { if (a.length >= r.min_txns) add("Structuring", k.split("|")[0], "", a[0].day, a.length, sum(a),
      `${a.length} txns in ${r.band_min.toLocaleString()}-${r.band_max.toLocaleString()} band`, r.severity, a); });

  r = rules.high_failure_rate;
  if (r?.enabled) Object.entries(group(t => t.vendor + "|" + t.day)).forEach(([k, a]) => {
    const failed = a.filter(t => ["FAILED", "FAILURE", "DECLINED"].includes(t.status)).length;
    if (a.length >= r.min_txns && failed / a.length >= r.max_fail_ratio)
      add("High failure rate", k.split("|")[0], "", a[0].day, failed, 0, `${failed}/${a.length} failed (${(failed/a.length*100).toFixed(0)}%)`, r.severity, a.filter(t=>["FAILED","FAILURE","DECLINED"].includes(t.status))); });

  r = rules.round_amount;
  if (r?.enabled) Object.entries(group(t => { const e = t.account || t.mobile || t.name; return (e && t.amount > 0 && t.amount % r.multiple_of === 0) ? e + "|" + t.day : null; }))
    .forEach(([k, a]) => { if (a.length >= r.min_txns) add("Round amounts", k.split("|")[0], "", a[0].day, a.length, sum(a),
      `${a.length} exact multiples of ${r.multiple_of.toLocaleString()}`, r.severity, a); });

  const ord = { High: 0, Medium: 1, Low: 2 };
  return flags.sort((x, y) => (ord[x.Severity] - ord[y.Severity]) || (y.Amount - x.Amount));
}

window.logic = { merchantRates, vendorCommission, riskScan, getRules, saveRules, DEFAULT_RULES, round2, num };
