/* Optional real Web Push for the JobPilot Home Screen PWA.
 * Only generic event types and times leave this device. No email content is sent.
 */
(() => {
  'use strict';
  const URL_KEY = 'jobpilot.push.url';
  const TOKEN_KEY = 'jobpilot.push.token';
  const DB_KEY = 'jobpilot.personal.v2';
  const $ = q => document.querySelector(q);
  let timer = null;
  const status = (message, isError=false) => { const el=$('#pushStatus'); if(el){el.textContent=message;el.dataset.error=String(isError);} };
  function getCredentials() {
    const raw = ($('#pushServerUrl')?.value || '').trim().replace(/\/+$/,'');
    const token = ($('#pushApiToken')?.value || '').trim();
    if(!raw || !token) throw Error('Enter the push server URL and your private API token.');
    const u = new URL(raw);
    if(u.protocol!=='https:' || u.pathname!=='/' || u.search || u.hash || u.username || u.password) throw Error('Use only the HTTPS Cloudflare Worker URL, without a path.');
    if(token.length<32) throw Error('The API token must be at least 32 characters.');
    return {url:u.origin,token};
  }
  const saveCredentials = () => {const {url,token}=getCredentials();localStorage.setItem(URL_KEY,url);localStorage.setItem(TOKEN_KEY,token);return {url,token};};
  function decodeB64u(s) {const str=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(str,c=>c.charCodeAt(0));}
  async function call(path, method='GET', payload, creds=getCredentials()) {
    const res = await fetch(creds.url+path,{method,headers:{'Authorization':`Bearer ${creds.token}`,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
    let output={}; try {output=await res.json();}catch{}
    if(!res.ok) throw Error(output.error || `Push server error (${res.status})`);
    return output;
  }
  async function remindersFromDevice() {
    const db=JSON.parse(localStorage.getItem(DB_KEY)||'{}');
    const events=Array.isArray(db.events)?db.events:[];
    const result=[]; const now=Date.now();
    for(const e of events) {
      const when=Date.parse(e.when);
      if(e.cancelled || e.completed || !Number.isFinite(when) || when <= now || when > now+366*86400000) continue;
      let eventId=String(e.id||'');
      if(e.calendarUid) {
        const sha=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(e.calendarUid));
        eventId='mail:'+Array.from(new Uint8Array(sha)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,30);
      }
      if(!/^[\w:.-]{1,125}$/.test(eventId)) continue;
      const kind=['Interview','Follow-up','Deadline','Other'].includes(e.type)?e.type:'Other';
      for(const milestone of [1440,60,15]) {const fireAt=when-milestone*60000;if(fireAt>now+10000) result.push({id:eventId,kind,milestone,fireAt,eventAt:when});}
    }
    return result.slice(0,600);
  }
  async function sync() {
    const {url,token}=getCredentials();
    const reminders=await remindersFromDevice();
    const result=await call('/reminders','PUT',{source:'planner',reminders},{url,token});
    status(`Cloud reminders synchronized: ${result.count} alerts scheduled. Last synced ${new Date().toLocaleTimeString()}.`);
  }
  async function subscribeFromTap() {
    try {
      if(!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw Error('Push is unavailable here. On iPhone, first Add JobPilot to Home Screen and open it from the icon (iOS 16.4+).');
      if(location.protocol!=='https:') throw Error('Push notifications require HTTPS.');
      const creds=saveCredentials();
      // Request directly from the user's tap, before any await to preserve iOS gesture.
      const permission=await Notification.requestPermission();
      if(permission!=='granted') throw Error('Permission was not granted. Enable notifications for JobPilot in iPhone Settings.');
      status('Enabling push notifications…');
      const registration=await navigator.serviceWorker.ready;
      const config=await call('/config','GET',null,creds);
      if(!config.vapidPublicKey) throw Error('Cloudflare Worker VAPID keys have not been configured.');
      let subscription=await registration.pushManager.getSubscription();
      if(subscription && subscription.options?.applicationServerKey) {
        const existing=new Uint8Array(subscription.options.applicationServerKey);
        const next=decodeB64u(config.vapidPublicKey);
        if(existing.length!==next.length || existing.some((v,i)=>v!==next[i])) {await subscription.unsubscribe();subscription=null;}
      }
      if(!subscription) subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeB64u(config.vapidPublicKey)});
      await call('/subscribe','POST',{subscription:subscription.toJSON()},creds);
      await sync();
      status('Push enabled. Your iPhone can receive reminders even while JobPilot is closed. Tap Send test to verify.');
    } catch(e) {status(e.message||'Could not enable push',true);}
  }
  async function unsubscribe() {
    try {
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub) {await call('/unsubscribe','POST',{endpoint:sub.endpoint}); await sub.unsubscribe();}
      status('Push disabled on this device. Other devices are unaffected.');
    } catch(e) {status(e.message,true);}
  }
  async function testPush() {
    try {
      const outcome=await call('/test','POST',{});
      status(outcome.delivered ? `Test sent to ${outcome.delivered} subscribed device(s). Check your notifications.` : 'Server is running but no device accepted the push. Check subscription and server logs.',!outcome.delivered);
    } catch(e) {status(e.message,true);}
  }
  async function syncQuietly() {
    if(!localStorage.getItem(URL_KEY) || !localStorage.getItem(TOKEN_KEY)) return;
    try {
      const reg=await navigator.serviceWorker.ready;
      if(!await reg.pushManager.getSubscription()) return;
      await sync();
    } catch(e) {status(`Push sync did not finish: ${e.message}`,true);}
  }
  function init() {
    if(!$('#pushEnable')) return;
    $('#pushServerUrl').value=localStorage.getItem(URL_KEY)||'';
    $('#pushApiToken').value=localStorage.getItem(TOKEN_KEY)||'';
    $('#pushEnable').addEventListener('click',subscribeFromTap);
    $('#pushDisable').addEventListener('click',unsubscribe);
    $('#pushTest').addEventListener('click',testPush);
    $('#pushSync').addEventListener('click',async()=>{try{saveCredentials();await sync();}catch(e){status(e.message,true);}});
    $('#pushServerUrl').addEventListener('change',()=>{status('Tap Enable push to connect to this server.');});
    window.addEventListener('jobpilot:changed',()=>{clearTimeout(timer);timer=setTimeout(syncQuietly,900);});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncQuietly();});
    if('Notification' in window && Notification.permission==='granted' && localStorage.getItem(URL_KEY)) setTimeout(syncQuietly,1000);
    if(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) status('On iPhone, first tap Safari Share → Add to Home Screen, then launch JobPilot from its icon.');
    else if(localStorage.getItem(URL_KEY)) status('Saved push server found. Tap Enable push or Sync reminders to reconnect.');
    else status('Not configured. Add the free Cloudflare Worker URL and private API token, then Enable push.');
  }
  document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',init) : init();
})();