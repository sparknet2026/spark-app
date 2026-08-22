/* App controller — peday-direct data, on-device commission + risk, no backend. */
const $ = id => document.getElementById(id);
const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
let alarmTimer = null, CACHE = { day: "", payins: [], payouts: [], rates: {} };
function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("on"); setTimeout(()=>t.classList.remove("on"),2600); }

setTimeout(() => { const s=$("splash"); if(s){ s.classList.add("hide"); setTimeout(()=>s.remove(),600); } }, 1400);

// ---- Per-device settings ----
function devId(){ let id=localStorage.getItem("peday_device"); if(!id){ id="DEV-"+Math.random().toString(36).slice(2,8).toUpperCase(); localStorage.setItem("peday_device",id);} return id; }
const SET={notif:"peday_notif",risk:"peday_risk",voice:"peday_voice",alarm:"peday_alarm"};
const getS=n=>localStorage.getItem(SET[n])==="1";
function paintS(){ Object.keys(SET).forEach(n=>{ const el=$(n+"Sw"); if(el) el.classList.toggle("on",getS(n)); }); if($("alarmSw")) $("alarmSw").classList.toggle("on",getS("alarm")); }
async function toggleS(n){ const on=!getS(n);
  if(on&&n==="notif"){ const ok=await ensureNotifPerm(); if(!ok){toast("Notification permission denied");return;} }
  localStorage.setItem(SET[n],on?"1":"0"); paintS(); if(n==="alarm"){ on?startAlarm():stopAlarm(); } toast(n+(on?" on":" off")); }
["notif","risk","voice"].forEach(n=>{ const el=$(n+"Sw"); if(el) el.addEventListener("click",()=>toggleS(n)); });
["alarmSw"].forEach(id=>{ const el=$(id); if(el) el.addEventListener("click",()=>toggleS("alarm")); });
// Live 3s auto-refresh — default ON (disabled only when explicitly set to "0").
const autoOn=()=>localStorage.getItem("peday_auto")!=="0";
function paintAuto(){ if($("autoSw")) $("autoSw").classList.toggle("on",autoOn()); }
if($("autoSw")) $("autoSw").addEventListener("click",()=>{ const on=!autoOn(); localStorage.setItem("peday_auto",on?"1":"0"); paintAuto(); toast("Live refresh "+(on?"on":"off")); on?startAuto():stopAuto(); });
$("voiceTest").addEventListener("click",()=>notify("⚠ Risk alert test","Same account 6 transactions in one day flagged",true));

// Native local notification plugin (fires on the device, even in the WebView).
const LN = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
let _nid = 1;
async function ensureNotifPerm(){
  const ln = LN();
  if(ln){ try{ const p = await ln.requestPermissions(); return p.display === "granted"; }catch(e){ return false; } }
  if("Notification"in window){ const p = await Notification.requestPermission(); return p === "granted"; }
  return false;
}
// LOUD alarm siren — alternating tones at high gain, plus device vibration.
let _ac = null;
function playAlarm(cycles){
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === "suspended") _ac.resume();
    const now = _ac.currentTime; cycles = cycles || 6;
    for (let i = 0; i < cycles; i++) {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = "square"; o.connect(g); g.connect(_ac.destination);
      const t = now + i * 0.34;
      o.frequency.setValueAtTime(i % 2 ? 1250 : 850, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);   // loud
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) {}
}
function speakLoud(text, times){
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    for (let i = 0; i < (times || 1); i++) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98; u.pitch = 1; u.volume = 1;      // full volume
      speechSynthesis.speak(u);
    }
  } catch (e) {}
}
function notify(title,body,urgent){
  if(!getS("notif")){ toast(title+" — "+body); return; }
  const ln = LN();
  if(ln){ // real device notification
    ln.schedule({ notifications:[{ id:_nid++, title, body, smallIcon:"ic_launcher",
      sound: urgent ? "default" : undefined, schedule:{ at:new Date(Date.now()+200) } }] }).catch(()=>toast(title+" — "+body));
  } else if("Notification"in window&&Notification.permission==="granted"){ new Notification(title,{body}); }
  else toast(title+" — "+body);
  // Urgent (risk) → loud siren; speak twice at full volume when voice is on.
  if(urgent) playAlarm(getS("risk") ? 8 : 6);
  if(getS("voice")) speakLoud(title + ". " + body, urgent ? 2 : 1);
}

// ---- Login ----
$("loginbtn").addEventListener("click", async () => {
  const btn=$("loginbtn"), err=$("loginerr"); err.style.display="none";
  // Unlock audio on this user gesture so the alarm can sound from later background checks.
  try{ _ac=_ac||new(window.AudioContext||window.webkitAudioContext)(); _ac.resume(); }catch(e){}
  peday.setEnv($("lenv").value);
  btn.disabled=true; btn.textContent="Signing in…";
  try {
    await peday.login($("lu").value.trim(), $("lp").value);
    localStorage.setItem("peday_auth","1");
    $("login").style.display="none"; $("app").style.display="flex";
    boot();
  } catch(e){ err.textContent=e.message; err.style.display="block"; }
  finally { btn.disabled=false; btn.textContent="Sign in"; }
});
$("logoutBtn").addEventListener("click", () => { peday.logout(); location.reload(); });
if (localStorage.getItem("peday_auth")==="1" && peday.isAuthed()) { $("login").style.display="none"; $("app").style.display="flex"; }

// ---- Nav ----
document.querySelectorAll(".nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("on")); b.classList.add("on");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("on")); $("v-"+b.dataset.view).classList.add("on");
  if(b.dataset.view==="risk") renderRisk();
  if(b.dataset.view==="wallet") loadWallet();
}));
// Environment is fixed at login (its token is env-specific). To switch, sign out
// and sign in to the other environment — this keeps the data from ever mixing.
// Selected date for the whole dashboard (defaults to today, changeable via filter).
let SELDATE = today();
$("refreshBtn").addEventListener("click",()=>{ CACHE.day=""; boot(true); });
$("dateGo").addEventListener("click",()=>{ SELDATE=$("selDate").value||today(); CACHE.day=""; boot(true); });
$("bell").addEventListener("click",()=>{ $("belldot").style.display="none"; notify("Commission","Total "+$("totalCom").textContent); });

// ---- Full load of the selected day (builds the seen-id sets for incremental) ----
async function loadData(){
  const d=SELDATE;
  const [payins,payouts,merch] = await Promise.all([ peday.payins(d,d), peday.payouts(d,d), peday.merchants() ]);
  const seenPin=new Set(payins.map(r=>r.GATEWAYTRANSACTIONID).filter(Boolean));
  const seenPout=new Set(payouts.map(r=>r.GATEWAYTRANSACTIONID).filter(Boolean));
  CACHE={ day:d, _env:peday.envName(), payins, payouts, rates: logic.merchantRates(merch), seenPin, seenPout };
  return CACHE;
}
// ---- Incremental: pull only NEW txns since last check; merge into CACHE. ----
async function refreshNew(){
  if(!CACHE.seenPin || CACHE.day!==SELDATE || CACHE._env!==peday.envName()) return -1; // needs full load
  const d=SELDATE;
  const [np,no] = await Promise.all([
    peday.fetchNew(peday.PAYIN_PATH, d, d, CACHE.seenPin),
    peday.fetchNew(peday.PAYOUT_PATH, d, d, CACHE.seenPout),
  ]);
  np.forEach(r=>{ if(r.GATEWAYTRANSACTIONID) CACHE.seenPin.add(r.GATEWAYTRANSACTIONID); });
  no.forEach(r=>{ if(r.GATEWAYTRANSACTIONID) CACHE.seenPout.add(r.GATEWAYTRANSACTIONID); });
  if(np.length) CACHE.payins=np.concat(CACHE.payins);
  if(no.length) CACHE.payouts=no.concat(CACHE.payouts);
  return np.length+no.length;
}
const dateLabel = () => SELDATE===today() ? "today" : SELDATE;

let _busy=false;
async function boot(silent){
  if(_busy) return; _busy=true;
  applyBoot();
  if(!silent) $("vendorList").innerHTML='<div class="empty"><span class="spin"></span></div>';
  try {
    const c = await loadData();
    render(c);
  } catch(e){ if(!silent) $("vendorList").innerHTML='<div class="empty">'+e.message+'</div>'; if(/sign in/i.test(e.message)){ peday.logout(); location.reload(); } }
  finally { _busy=false; }
}
function render(c){
    const vc=logic.vendorCommission(c.payins,c.payouts,c.rates);
    let payin=0,payout=0,gst=0,payinTx=0,payoutTx=0,payinAmt=0,payoutAmt=0; const byV={};
    vc.forEach(x=>{ if(x.Mode==="Payin"){payin+=x.Total;payinTx+=x.Txns;payinAmt+=x.Base;} else {payout+=x.Total;payoutTx+=x.Txns;payoutAmt+=x.Base;}
      gst+=x.GST; const v=(byV[x.Vendor]=byV[x.Vendor]||{name:x.VendorName,pinAmt:0,poutAmt:0,pinCom:0,poutCom:0});
      if(x.Mode==="Payin"){v.pinAmt+=x.Base;v.pinCom+=x.Total;} else {v.poutAmt+=x.Base;v.poutCom+=x.Total;} });
    $("totalCom").textContent=inr(payin+payout); $("payinCom").textContent=inr(payin); $("payoutCom").textContent=inr(payout); $("gstCom").textContent=inr(gst);
    $("payinTx").textContent=payinTx.toLocaleString("en-IN"); $("payoutTx").textContent=payoutTx.toLocaleString("en-IN"); $("totalTx").textContent=(payinTx+payoutTx).toLocaleString("en-IN");
    $("payinAmt").textContent=inr(payinAmt); $("payoutAmt").textContent=inr(payoutAmt); $("totalAmt").textContent=inr(payinAmt+payoutAmt);
    $("comTitle").textContent="Commission · "+dateLabel(); $("txnTitle").textContent="Transactions · "+dateLabel();
    const items=Object.entries(byV).map(([c,v])=>[c,{...v,amt:v.pinAmt+v.poutAmt,com:v.pinCom+v.poutCom}]).sort((a,b)=>b[1].amt-a[1].amt);
    $("vendorList").innerHTML=items.length?items.map(([code,v])=>`<div class="rowline">
      <div class="l">${code} <small style="display:inline;color:var(--muted)">${v.name||""}</small>
        <small>trx <b>${inr(v.amt)}</b> · comm <b>${inr(v.com)}</b></small>
        <small><span style="color:var(--ok)">in: ${inr(v.pinAmt)} / ${inr(v.pinCom)}</span> · <span style="color:var(--brand)">out: ${inr(v.poutAmt)} / ${inr(v.poutCom)}</span></small></div>
      <div class="r">${inr(v.com)}</div></div>`).join(""):'<div class="empty">No data for '+dateLabel()+'.</div>';
    $("lastupd").textContent="Updated "+new Date().toLocaleTimeString();
    $("barsub").textContent=peday.envName()==="spark"?"Spark · today":"Peday · today"; $("curenv").textContent=peday.envName()==="spark"?"Spark":"Peday";
    checkRisk(c);
}
function applyBoot(){ paintS(); paintAuto(); if($("selDate")&&!$("selDate").value) $("selDate").value=SELDATE; if($("deviceId")) $("deviceId").textContent=devId(); if($("who")) $("who").textContent=peday.email; if(getS("alarm")) startAlarm(); startAuto(); }

// Auto-refresh every 3s — live only (today), only on the dashboard, non-overlapping.
let autoTimer=null;
function startAuto(){ if(autoTimer||!autoOn()) return; paintAuto(); autoTimer=setInterval(async()=>{
  if(!autoOn()||_busy) return;
  if(!$("v-dash").classList.contains("on")) return;
  if(SELDATE!==today()) return;
  _busy=true;
  try {
    const n = await refreshNew();          // light: only new txns
    if(n===-1){ await loadData(); render(CACHE); }   // cache stale -> full load once
    else if(n>0){ render(CACHE); }          // new txns -> re-render from cache
    // n===0 -> nothing changed, no work
  } catch(e){ if(/sign in/i.test(e.message)){ peday.logout(); location.reload(); } }
  finally { _busy=false; }
}, 3000); }
function stopAuto(){ if(autoTimer) clearInterval(autoTimer); autoTimer=null; }

// ---- Risk ----
let LAST_RISK=[];
function checkRisk(c){ LAST_RISK=logic.riskScan(c.payins,c.payouts,logic.getRules());
  if(LAST_RISK.length){ $("riskdot").style.display="block"; if(getS("risk")) notify("⚠ Risk alert",LAST_RISK.length+" transaction(s) flagged today",true); } }
function renderRisk(){
  const rows=LAST_RISK; $("riskCount").textContent=rows.length+" flags"; $("riskCount").className="pill "+(rows.length?"p-bad":"p-ok");
  const sev=s=>s==="High"?"p-bad":(s==="Medium"?"p-warn":"p-ok");
  $("riskList").innerHTML=rows.length?rows.map(x=>`<div class="rowline"><div class="l">${x.Rule}<small>${x.Entity} · ${x.Merchant||""} · ${x.Detail||""}</small></div><div class="r"><span class="pill ${sev(x.Severity)}">${x.Severity}</span></div></div>`).join(""):'<div class="empty">✓ No risk flags today.</div>';
}

// ---- Wallet ----
async function loadWallet(){
  const sel=$("walletMerch");
  if(!sel.options.length){ Object.keys(CACHE.rates).forEach(m=>{const o=document.createElement("option");o.value=o.textContent=m;sel.appendChild(o);}); sel.onchange=loadWallet; }
  $("ledgerList").innerHTML='<div class="empty"><span class="spin"></span></div>';
  try {
    const rows=await peday.ledger(sel.value||Object.keys(CACHE.rates)[0]);
    const sorted=[...rows].sort((a,b)=>String(b.CREATEDAT||"").localeCompare(String(a.CREATEDAT||""))).slice(0,60);
    const newest=sorted[0]; $("walletBal").textContent=inr(logic.num(newest&&newest.BALANCEAFTER));
    const dc=x=>x.DIRECTION==="CREDIT"?"var(--ok)":"var(--bad)";
    $("ledgerList").innerHTML=sorted.length?sorted.map(x=>`<div class="rowline"><div class="l">${x.TYPE}<small>${String(x.CREATEDAT||"").slice(0,16).replace("T"," ")} · ${x.DIRECTION}</small></div><div class="r" style="color:${dc(x)}">${x.DIRECTION==="CREDIT"?"+":"−"}${inr(logic.num(x.AMOUNT))}</div></div>`).join(""):'<div class="empty">No entries.</div>';
  } catch(e){ $("ledgerList").innerHTML='<div class="empty">'+e.message+'</div>'; }
}

// ---- Hourly alarm ----
function startAlarm(){ stopAlarm(); alarmTimer=setInterval(async()=>{ CACHE.day=""; await boot(); $("belldot").style.display="block"; notify("Hourly update","Total "+$("totalCom").textContent); },3600*1000); }
function stopAlarm(){ if(alarmTimer) clearInterval(alarmTimer); alarmTimer=null; }

if (localStorage.getItem("peday_auth")==="1" && peday.isAuthed()) boot();
