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
$("logoutBtn").addEventListener("click", () => { peday.forget(); location.reload(); });
if (localStorage.getItem("peday_auth")==="1" && peday.isAuthed()) { $("login").style.display="none"; $("app").style.display="flex"; }
else {
  // Not signed in: pre-fill saved credentials and auto sign-in if we have them.
  const c=peday.savedCreds();
  if(c.email) $("lu").value=c.email;
  if(c.pw) $("lp").value=c.pw;
  if($("lenv")) $("lenv").value=peday.envName();
  if(c.email && c.pw) setTimeout(()=>$("loginbtn").click(), 100);
}

// ---- Nav ----
document.querySelectorAll(".nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("on")); b.classList.add("on");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("on")); $("v-"+b.dataset.view).classList.add("on");
  if(b.dataset.view==="risk") renderRisk();
  if(b.dataset.view==="wallet") loadWallet();
  if(b.dataset.view==="flow") loadFlow();
}));
// Environment is fixed at login (its token is env-specific). To switch, sign out
// and sign in to the other environment — this keeps the data from ever mixing.
// Selected date for the whole dashboard (defaults to today, changeable via filter).
let SELDATE = today();
$("refreshBtn").addEventListener("click",()=>{ CACHE.day=""; boot(true); });
$("dateGo").addEventListener("click",()=>{ SELDATE=$("selDate").value||today(); CACHE.day=""; boot(true); });
$("bell").addEventListener("click",()=>{ $("belldot").style.display="none"; notify("Commission","Total "+$("totalCom").textContent); });
$("sheetClose").onclick=()=>$("sheet").classList.remove("on");
$("sheet").onclick=e=>{ if(e.target.id==="sheet") $("sheet").classList.remove("on"); };

// Risk flow filter (All / Payin / Payout)
document.querySelectorAll("#riskseg button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("#riskseg button").forEach(x=>x.classList.remove("on")); b.classList.add("on");
  RISKMODE=b.dataset.rm; renderRisk();
}));
// Lookup: count a mobile number or UPI's SUCCESSFUL transactions (loaded date).
$("lookupBtn").addEventListener("click", doLookup);
$("lookupQ").addEventListener("keydown", e=>{ if(e.key==="Enter") doLookup(); });
function doLookup(){
  const q=($("lookupQ").value||"").trim().toLowerCase();
  if(!q){ $("lookupRes").innerHTML='<div class="muted" style="margin-top:12px">Enter a mobile number or UPI.</div>'; return; }
  const all=[...(CACHE.payins||[]).map(r=>({r,mode:"Payin"})),...(CACHE.payouts||[]).map(r=>({r,mode:"Payout"}))];
  const match=all.filter(({r})=>{
    const st=String(r.PAYMENTSTATUS||r.TXNSTATUS||"").toUpperCase(); if(!peday.SUCCESS.has(st)) return false;
    const mob=String(r.CUSTOMERMOBILENUMBER||"").toLowerCase();
    const vpa=String(r.PAYERVPA||r.CUSTOMERVPA||"").toLowerCase();
    return mob.includes(q)||vpa.includes(q);
  });
  const total=match.reduce((s,{r})=>s+logic.num(r.APPROVEDAMOUNT),0);
  if(!match.length){ $("lookupRes").innerHTML='<div class="empty">No successful transactions for "'+q+'" on '+dateLabel()+'.</div>'; return; }
  const rows=match.map(({r,mode})=>({name:r.CUSTOMERNAME||r.PAYERNAME||"",mob:r.CUSTOMERMOBILENUMBER||"",vpa:r.PAYERVPA||r.CUSTOMERVPA||"",amt:logic.num(r.APPROVEDAMOUNT),mode,time:r.TRANSACTIONTIMESTAMP||r.CREATEDAT||r.CREATEDDATE||"",id:r.GATEWAYTRANSACTIONID||""}))
    .sort((a,b)=>String(b.time).localeCompare(String(a.time)));
  $("lookupRes").innerHTML=`<div class="rowline" style="border-top:1px solid var(--line);margin-top:10px"><div class="l"><b>${match.length} successful txn${match.length>1?"s":""}</b><small>${dateLabel()}</small></div><div class="r">${inr(total)}</div></div>`+
    rows.map(x=>`<div class="rowline"><div class="l">${x.name||x.vpa||x.mob||"—"}<small>${x.mob}${x.vpa?" · "+x.vpa:""} · ${(x.time||"").slice(0,16).replace("T"," ")} · ${x.mode}</small></div><div class="r">${inr(x.amt)}</div></div>`).join("");
}

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
    _curCom=payin+payout; _curTx=payinTx+payoutTx;
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
function applyBoot(){ paintS(); paintAuto(); if($("selDate")&&!$("selDate").value) $("selDate").value=SELDATE; if($("deviceId")) $("deviceId").textContent=devId(); if($("who")) $("who").textContent=peday.email; if(getS("alarm")) startAlarm(); startAuto(); seedRunner(); }
// Seed the background task with credentials so it can run risk checks when the app
// is closed (~every 10-15 min, OS-limited). Uses the saved login; no server needed.
async function seedRunner(){
  try{
    const BR=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.BackgroundRunner;
    if(!BR) return;
    const c=peday.savedCreds(); if(!c.email||!c.pw) return;
    await BR.dispatchEvent({ label:"money.peday.commission.risk", event:"saveCreds",
      details:{ email:c.email, pw:c.pw, base:peday.ENVS[peday.envName()] } });
  }catch(e){}
}

// Auto-refresh every 3s — live only (today), only on the dashboard, non-overlapping.
let autoTimer=null, _curCom=0, _curTx=0;
// Lightweight "commission updated" ping — toast + optional device notification,
// no siren/voice (that's reserved for risk).
function updateNotify(title,body){
  toast(title+" "+body);
  if(getS("notif")){ const ln=LN();
    if(ln) ln.schedule({notifications:[{id:_nid++,title,body,schedule:{at:new Date(Date.now()+200)}}]}).catch(()=>{});
    else if(window.Notification&&Notification.permission==="granted") new Notification(title,{body}); }
}
function flashCom(){ const el=document.querySelector(".hero"); if(!el) return; el.style.transition="box-shadow .2s"; el.style.boxShadow="0 0 0 3px var(--ok)"; setTimeout(()=>el.style.boxShadow="",700); }
function startAuto(){ if(autoTimer||!autoOn()) return; paintAuto(); autoTimer=setInterval(async()=>{
  if(!autoOn()||_busy) return;
  if(!$("v-dash").classList.contains("on")) return;
  if(SELDATE!==today()) return;
  _busy=true;
  try {
    const beforeCom=_curCom, beforeTx=_curTx;
    const n = await refreshNew();          // light: only new txns
    if(n===-1){ await loadData(); render(CACHE); }   // cache stale -> full load once
    else if(n>0){                          // new txns -> re-render + signal the update
      render(CACHE);
      const dCom=_curCom-beforeCom, dTx=_curTx-beforeTx;
      if(dTx>0){ flashCom(); updateNotify("Commission updated", `+${inr(dCom)} · ${dTx} new txn`+(dTx>1?"s":"")); }
    }
    // n===0 -> nothing changed, no work
  } catch(e){ if(/sign in/i.test(e.message)){ peday.logout(); location.reload(); } }
  finally { _busy=false; }
}, 3000); }
function stopAuto(){ if(autoTimer) clearInterval(autoTimer); autoTimer=null; }

// ---- Risk ----
let LAST_RISK=[];
// Stable identity for a flag, so "ignore" persists across refreshes.
const flagKey=f=>`${f.Rule}|${f.Entity}|${f.Date}|${f.Mode}`;
function ignoredSet(){ try{ return new Set(JSON.parse(localStorage.getItem("peday_ignored"))||[]); }catch(e){ return new Set(); } }
function saveIgnored(s){ localStorage.setItem("peday_ignored", JSON.stringify([...s])); }
function ignoreFlag(k){ const s=ignoredSet(); s.add(k); saveIgnored(s); renderRisk(); const a=activeRisk(); $("riskdot").style.display=a.length?"block":"none"; }
function unignoreFlag(k){ const s=ignoredSet(); s.delete(k); saveIgnored(s); renderRisk(); }
const activeRisk=()=>{ const ig=ignoredSet(); return LAST_RISK.filter(f=>!ig.has(flagKey(f))); };

function checkRisk(c){ LAST_RISK=logic.riskScan(c.payins,c.payouts,logic.getRules());
  const active=activeRisk();
  if(active.length){ $("riskdot").style.display="block"; if(getS("risk")) notify("⚠ Risk alert",active.length+" transaction(s) flagged today",true); }
  else $("riskdot").style.display="none";
}
let _riskIndex={};
// Risk mode filter: recompute flags for the selected flow (all / payin / payout).
let RISKMODE="all";
function riskForMode(){
  if(RISKMODE==="payin")  return logic.riskScan(CACHE.payins||[], [], logic.getRules());
  if(RISKMODE==="payout") return logic.riskScan([], CACHE.payouts||[], logic.getRules());
  return LAST_RISK;
}
function renderRisk(){
  const ig=ignoredSet();
  const byLatest=(a,b)=>String(b.Time||b.Date||"").localeCompare(String(a.Time||a.Date||"")); // newest first
  const SRC=riskForMode();
  const active=SRC.filter(f=>!ig.has(flagKey(f))).sort(byLatest);
  const ignored=SRC.filter(f=>ig.has(flagKey(f))).sort(byLatest);
  $("riskCount").textContent=active.length+" flags"; $("riskCount").className="pill "+(active.length?"p-bad":"p-ok");
  const sev=s=>s==="High"?"p-bad":(s==="Medium"?"p-warn":"p-ok");
  _riskIndex={}; SRC.forEach(f=>_riskIndex[flagKey(f)]=f);
  // Total flagged transactions (unique) + amount across active flags.
  const seen=new Set(); let flaggedAmt=0;
  active.forEach(f=>(f.Rows||[]).forEach(r=>{ if(r.id&&!seen.has(r.id)){ seen.add(r.id); flaggedAmt+=r.amount||0; } }));
  const summary=`<div class="rowline" style="border-bottom:2px solid var(--line)"><div class="l"><b>${active.length} flags · ${seen.size} transactions</b><small>${RISKMODE==="all"?"payin + payout":RISKMODE} · ${dateLabel()}</small></div><div class="r">${inr(flaggedAmt)}</div></div>`;
  const row=(x,isIg)=>{ const k=flagKey(x).replace(/"/g,"&quot;");
    const btn=isIg?`<button class="btn2" data-unign="${k}" style="padding:5px 9px;font-size:11px">Unignore</button>`
                  :`<button class="btn2" data-ign="${k}" style="padding:5px 9px;font-size:11px">Ignore</button>`;
    const t=x.Time&&x.Time.length>10?" · "+x.Time.slice(11,16):"";
    const md=x.Mode?` · <b>${x.Mode}</b>`:"";
    return `<div class="rowline" style="${isIg?'opacity:.5':''}" data-flag="${k}"><div class="l" style="cursor:pointer">${x.Rule} <span class="pill ${sev(x.Severity)}">${x.Severity}</span><small>${x.Entity} · ${x.Merchant||""}${md} · ${x.Count} trx${t}</small><small style="color:var(--brand)">tap to see ${x.Count} transactions ▸</small></div>
      <div class="r" style="display:flex;gap:6px;align-items:center">${btn}</div></div>`; };
  let html = (active.length||ignored.length ? summary : "") + (active.length?active.map(x=>row(x,false)).join(""):'<div class="empty">✓ No active risk flags.</div>');
  if(ignored.length) html += `<div class="muted" style="margin:10px 0 4px;font-weight:700">Ignored (${ignored.length})</div>` + ignored.map(x=>row(x,true)).join("");
  $("riskList").innerHTML=html;
  $("riskList").querySelectorAll("[data-ign]").forEach(b=>b.onclick=e=>{e.stopPropagation();ignoreFlag(b.getAttribute("data-ign"));});
  $("riskList").querySelectorAll("[data-unign]").forEach(b=>b.onclick=e=>{e.stopPropagation();unignoreFlag(b.getAttribute("data-unign"));});
  $("riskList").querySelectorAll("[data-flag] .l").forEach(el=>el.onclick=()=>showFlag(el.parentElement.getAttribute("data-flag")));
}
// Flag detail sheet: list the flagged transactions + their total.
function showFlag(k){
  const f=_riskIndex[k]; if(!f) return;
  const rows=(f.Rows||[]).slice().sort((a,b)=>String(b.time||"").localeCompare(String(a.time||"")));
  const total=rows.reduce((s,r)=>s+(r.amount||0),0);
  $("sheetTitle").textContent=f.Rule+" — "+f.Entity;
  $("sheetSub").textContent=`${f.Count} transactions · total ${inr(total)}`;
  $("sheetBody").innerHTML=rows.map(r=>`<div class="rowline"><div class="l">${r.name||r.vpa||r.account||r.mobile||"—"}<small>${r.mobile||""}${r.vpa?" · "+r.vpa:""} · ${(r.time||"").slice(0,16).replace("T"," ")} · ${r.mode} · <b>${r.status}</b>${r.reason&&r.status!=="SUCCESS"?" · "+r.reason:""}</small></div><div class="r">${inr(r.amount)}</div></div>`).join("")||'<div class="empty">No transactions.</div>';
  $("sheet").classList.add("on");
}

// ---- Trx Flow: per-merchant consecutive failures + hourly volume spike ----
let FLOWMODE="payin";
document.querySelectorAll("#flowseg button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("#flowseg button").forEach(x=>x.classList.remove("on")); b.classList.add("on");
  FLOWMODE=b.dataset.fm; loadFlow();
}));
function loadFlow(){
  const recs = FLOWMODE==="payout" ? (CACHE.payouts||[]) : (CACHE.payins||[]);
  $("flowTitle").textContent="Merchant flow · "+FLOWMODE;
  const FAILED=new Set(["FAILED","FAILURE","DECLINED","REJECTED"]);
  const byM={};
  recs.forEach(r=>{
    const code=r.MERCHANTCODE||"—", st=String(r.PAYMENTSTATUS||r.TXNSTATUS||"").toUpperCase();
    const ts=String(r.TRANSACTIONTIMESTAMP||r.CREATEDAT||r.CREATEDDATE||""), amt=logic.num(r.APPROVEDAMOUNT);
    const hm=ts.match(/[T ](\d{1,2}):/), hr=hm?hm[1]:null;
    const m=(byM[code]=byM[code]||{txns:[],succ:0,fail:0,amt:0,hours:{}});
    m.txns.push({ts,failed:FAILED.has(st)});
    if(FAILED.has(st)) m.fail++; else if(peday.SUCCESS.has(st)){ m.succ++; m.amt+=amt; }
    if(hr!=null) m.hours[hr]=(m.hours[hr]||0)+1;
  });
  const rows=Object.entries(byM).map(([code,m])=>{
    const sorted=m.txns.sort((a,b)=>String(a.ts).localeCompare(String(b.ts)));
    let run=0,maxRun=0; sorted.forEach(t=>{ if(t.failed){run++; if(run>maxRun)maxRun=run;} else run=0; });
    const hv=Object.values(m.hours), maxH=hv.length?Math.max(...hv):0;
    const others=hv.filter(v=>v!==maxH), avgH=others.length?others.reduce((s,v)=>s+v,0)/others.length:0;
    const spike=avgH>0?maxH/avgH:1;
    return {code,name:(CACHE.rates[code]&&CACHE.rates[code].name)||"",succ:m.succ,fail:m.fail,total:m.txns.length,amt:m.amt,maxRun,spike};
  }).sort((a,b)=>(b.maxRun-a.maxRun)||(b.total-a.total));
  $("flowList").innerHTML=rows.length?rows.map(r=>{
    const fails=r.maxRun>=3?`<span class="pill p-bad">${r.maxRun} consecutive fails</span>`:"";
    const sp=r.spike>=3?`<span class="pill p-warn">volume spike ${r.spike.toFixed(1)}×</span>`:"";
    return `<div class="rowline"><div class="l">${r.code} <small style="display:inline;color:var(--muted)">${r.name}</small><small>✓${r.succ} ✗${r.fail} of ${r.total}</small>${(fails||sp)?`<small>${fails} ${sp}</small>`:""}</div><div class="r">${inr(r.amt)}</div></div>`;
  }).join(""):'<div class="empty">No '+FLOWMODE+' transactions for '+dateLabel()+'.</div>';
}

// ---- Wallet ----
async function loadWalletTotals(){
  const codes=Object.keys(CACHE.rates||{}); if(!codes.length) return;
  $("walletMlist").innerHTML='<div class="empty"><span class="spin"></span></div>';
  try{
    const results=await Promise.all(codes.map(c=>peday.balance(c).then(d=>({
      c, total:logic.num(d.BALANCE),
      avail:logic.num(d.AVAILABLEPAYOUTBALANCE!=null?d.AVAILABLEPAYOUTBALANCE:d.BALANCE),
      held:logic.num(d.UNSETTLEDBALANCE||d.LOCKED||0),
    })).catch(()=>({c,total:0,avail:0,held:0}))));
    const total=results.reduce((s,r)=>s+r.total,0), avail=results.reduce((s,r)=>s+r.avail,0), held=results.reduce((s,r)=>s+r.held,0);
    $("walletTotal").textContent=inr(total); $("walletAvail").textContent=inr(avail); $("walletHeld").textContent=inr(held); $("walletN").textContent=results.length;
    $("walletMlist").innerHTML=results.sort((a,b)=>b.total-a.total).map(r=>`<div class="rowline"><div class="l">${r.c}<small>${CACHE.rates[r.c]&&CACHE.rates[r.c].name||""}</small></div><div class="r">${inr(r.total)}<small class="muted">${inr(r.avail)} avail · ${inr(r.held)} held</small></div></div>`).join("");
  }catch(e){ $("walletMlist").innerHTML='<div class="empty">'+e.message+'</div>'; }
}
async function loadWallet(){
  loadWalletTotals();
  const sel=$("walletMerch");
  if(!sel.options.length){ Object.keys(CACHE.rates).forEach(m=>{const o=document.createElement("option");o.value=o.textContent=m;sel.appendChild(o);}); sel.onchange=loadWallet; }
  $("ledgerList").innerHTML='<div class="empty"><span class="spin"></span></div>';
  try {
    const mcode=sel.value||Object.keys(CACHE.rates)[0];
    const [rows,bal]=await Promise.all([peday.ledger(mcode), peday.balance(mcode).catch(()=>({}))]);
    const av=logic.num(bal.AVAILABLEPAYOUTBALANCE!=null?bal.AVAILABLEPAYOUTBALANCE:bal.BALANCE), hd=logic.num(bal.UNSETTLEDBALANCE||0);
    $("walletBal").innerHTML=`${inr(logic.num(bal.BALANCE))}<small class="muted">${inr(av)} avail · ${inr(hd)} held</small>`;
    const sorted=[...rows].sort((a,b)=>String(b.CREATEDAT||"").localeCompare(String(a.CREATEDAT||""))).slice(0,60);
    const dc=x=>x.DIRECTION==="CREDIT"?"var(--ok)":"var(--bad)";
    $("ledgerList").innerHTML=sorted.length?sorted.map(x=>`<div class="rowline"><div class="l">${x.TYPE}<small>${String(x.CREATEDAT||"").slice(0,16).replace("T"," ")} · ${x.DIRECTION}</small></div><div class="r" style="color:${dc(x)}">${x.DIRECTION==="CREDIT"?"+":"−"}${inr(logic.num(x.AMOUNT))}</div></div>`).join(""):'<div class="empty">No entries.</div>';
  } catch(e){ $("ledgerList").innerHTML='<div class="empty">'+e.message+'</div>'; }
}

// ---- Hourly alarm ----
function startAlarm(){ stopAlarm(); alarmTimer=setInterval(async()=>{ CACHE.day=""; await boot(); $("belldot").style.display="block"; notify("Hourly update","Total "+$("totalCom").textContent); },3600*1000); }
function stopAlarm(){ if(alarmTimer) clearInterval(alarmTimer); alarmTimer=null; }

if (localStorage.getItem("peday_auth")==="1" && peday.isAuthed()) boot();
