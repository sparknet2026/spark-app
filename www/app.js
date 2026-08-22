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
  if(on&&n==="notif"&&"Notification"in window&&Notification.permission!=="granted"){ const p=await Notification.requestPermission(); if(p!=="granted"){toast("Permission denied");return;} }
  localStorage.setItem(SET[n],on?"1":"0"); paintS(); if(n==="alarm"){ on?startAlarm():stopAlarm(); } toast(n+(on?" on":" off")); }
["notif","risk","voice"].forEach(n=>{ const el=$(n+"Sw"); if(el) el.addEventListener("click",()=>toggleS(n)); });
["alarmSw"].forEach(id=>{ const el=$(id); if(el) el.addEventListener("click",()=>toggleS("alarm")); });
$("voiceTest").addEventListener("click",()=>notify("⚠ Risk alert test","Same account 6 transactions in one day flagged",true));

function notify(title,body,urgent){
  if(!getS("notif")){ toast(title+" — "+body); return; }
  if("Notification"in window&&Notification.permission==="granted") new Notification(title,{body});
  else toast(title+" — "+body);
  if(getS("voice")&&"speechSynthesis"in window){ try{
    if(urgent){ const ac=new(window.AudioContext||window.webkitAudioContext)(); const o=ac.createOscillator(),g=ac.createGain(); o.connect(g);g.connect(ac.destination); o.frequency.value=880;o.start();g.gain.setValueAtTime(.2,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.4);o.stop(ac.currentTime+.4);}
    const u=new SpeechSynthesisUtterance(title+". "+body); u.rate=.95; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){} }
}

// ---- Login ----
$("loginbtn").addEventListener("click", async () => {
  const btn=$("loginbtn"), err=$("loginerr"); err.style.display="none";
  peday.setEnv($("lenv").value);
  btn.disabled=true; btn.textContent="Signing in…";
  try {
    await peday.login($("lu").value.trim(), $("lp").value);
    localStorage.setItem("peday_auth","1");
    $("login").style.display="none"; $("app").style.display="flex";
    document.querySelectorAll("#envseg button").forEach(b=>b.classList.toggle("on",b.dataset.env===peday.envName()));
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
document.querySelectorAll("#envseg button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("#envseg button").forEach(x=>x.classList.remove("on")); b.classList.add("on");
  peday.setEnv(b.dataset.env); CACHE.day=""; boot();
}));
$("refreshBtn").addEventListener("click",()=>{ CACHE.day=""; boot(true); });
$("bell").addEventListener("click",()=>{ $("belldot").style.display="none"; notify("Commission","Total "+$("totalCom").textContent); });

// ---- Load today's data once, reuse for commission + risk ----
async function loadData(force){
  if(!force && CACHE.day===today() && CACHE.payins.length!=null && CACHE._env===peday.envName()) return CACHE;
  const d=today();
  const [payins,payouts,merch] = await Promise.all([ peday.payins(d,d), peday.payouts(d,d), peday.merchants() ]);
  CACHE={ day:d, _env:peday.envName(), payins, payouts, rates: logic.merchantRates(merch) };
  return CACHE;
}

async function boot(){
  applyBoot();
  $("vendorList").innerHTML='<div class="empty"><span class="spin"></span></div>';
  try {
    const c=await loadData(true);
    const vc=logic.vendorCommission(c.payins,c.payouts,c.rates);
    let payin=0,payout=0,gst=0,payinTx=0,payoutTx=0; const byV={};
    vc.forEach(x=>{ if(x.Mode==="Payin"){payin+=x.Total;payinTx+=x.Txns;} else {payout+=x.Total;payoutTx+=x.Txns;}
      gst+=x.GST; (byV[x.Vendor]=byV[x.Vendor]||{name:x.VendorName,payin:0,payout:0,total:0});
      if(x.Mode==="Payin")byV[x.Vendor].payin+=x.Total; else byV[x.Vendor].payout+=x.Total; byV[x.Vendor].total+=x.Total; });
    $("totalCom").textContent=inr(payin+payout); $("payinCom").textContent=inr(payin); $("payoutCom").textContent=inr(payout); $("gstCom").textContent=inr(gst);
    $("payinTx").textContent=payinTx.toLocaleString("en-IN"); $("payoutTx").textContent=payoutTx.toLocaleString("en-IN"); $("totalTx").textContent=(payinTx+payoutTx).toLocaleString("en-IN");
    const items=Object.entries(byV).sort((a,b)=>b[1].total-a[1].total);
    $("vendorList").innerHTML=items.length?items.map(([code,v])=>`<div class="rowline"><div class="l">${code}<small>${v.name||""} · <span style="color:var(--ok)">in ${inr(v.payin)}</span> · <span style="color:var(--brand)">out ${inr(v.payout)}</span></small></div><div class="r">${inr(v.total)}</div></div>`).join(""):'<div class="empty">No commission today.</div>';
    $("lastupd").textContent="Updated "+new Date().toLocaleTimeString();
    $("barsub").textContent=peday.envName()==="spark"?"Spark · today":"Peday · today"; $("curenv").textContent=peday.envName()==="spark"?"Spark":"Peday";
    checkRisk(c);
  } catch(e){ $("vendorList").innerHTML='<div class="empty">'+e.message+'</div>'; if(/sign in/i.test(e.message)){ peday.logout(); location.reload(); } }
}
function applyBoot(){ paintS(); if($("deviceId")) $("deviceId").textContent=devId(); if($("who")) $("who").textContent=peday.email; if(getS("alarm")) startAlarm(); }

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
