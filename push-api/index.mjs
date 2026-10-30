/* JobPilot Personal Web Push API — Cloudflare Worker + D1; no runtime npm dependencies.
 * Push payload is generic. Job names, email text, and notes stay on the device.
 * RFC 8291 / 8188 / 8292: AES-128-GCM encrypted Web Push + VAPID ES256.
 */
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra}
});
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u = value => Uint8Array.from(atob(String(value).replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const concat = (...buffers) => {
  const items = buffers.map(b => b instanceof Uint8Array ? b : new Uint8Array(b));
  const out = new Uint8Array(items.reduce((sum,b)=>sum+b.length,0));
  let at=0; for(const b of items){ out.set(b,at); at+=b.length; } return out;
};
const sha = async string => new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(string)));
async function isAuthorized(request, env) {
  if (!env.PUSH_API_TOKEN || env.PUSH_API_TOKEN.length < 32) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 600) return false;
  const [left,right] = await Promise.all([sha(header.slice(7)),sha(env.PUSH_API_TOKEN)]);
  let diff = 0; for(let i=0;i<left.length;i++) diff |= left[i]^right[i];
  return diff === 0;
}
function allowedOrigin(env) {
  try { const url=new URL(env.ALLOWED_ORIGIN || ''); return url.protocol==='https:' ? url.origin : ''; } catch { return ''; }
}
function cors(request, env) {
  const origin = request.headers.get('Origin');
  return origin && origin === allowedOrigin(env) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary':'Origin',
  } : {};
}
function validPushEndpoint(value) {
  try {
    const url = new URL(value);
    const h = url.hostname.toLowerCase();
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && (
      h === 'web.push.apple.com' || h.endsWith('.push.apple.com') ||
      h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com' ||
      h === 'wns2.notify.windows.com' || h.endsWith('.notify.windows.com')
    ) && value.length < 1800;
  } catch { return false; }
}
function validSubscription(s) {
  return s && typeof s === 'object' && validPushEndpoint(s.endpoint) &&
    typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' &&
    s.keys.p256dh.length < 150 && s.keys.auth.length < 100 &&
    (()=>{try{return unb64u(s.keys.p256dh).length===65 && unb64u(s.keys.auth).length===16;}catch{return false;}})();
}
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}
async function hkdfExtract(salt, ikm) { return hmac(salt,ikm); }
async function hkdfExpand(prk, info, len) {
  const result = []; let t = new Uint8Array();
  for(let n=1; result.length < len; n++) {
    t = await hmac(prk, concat(t, info, Uint8Array.of(n)));
    result.push(...t);
  }
  return Uint8Array.from(result.slice(0,len));
}
async function encryptWebPush(subscription, message) {
  const userPublic = unb64u(subscription.keys.p256dh);
  const auth = unb64u(subscription.keys.auth);
  const userKey = await crypto.subtle.importKey('raw',userPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const ephKeys = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const ephPublic = new Uint8Array(await crypto.subtle.exportKey('raw',ephKeys.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:userKey},ephKeys.privateKey,256));
  const prkKey = await hkdfExtract(auth,shared);
  const keyInfo = concat(enc.encode('WebPush: info\0'),userPublic,ephPublic);
  const ikm = await hkdfExpand(prkKey,keyInfo,32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt,ikm);
  const cek = await hkdfExpand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce = await hkdfExpand(prk,enc.encode('Content-Encoding: nonce\0'),12);
  const aesKey = await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const plaintext = concat(enc.encode(JSON.stringify(message)),Uint8Array.of(2));
  if(plaintext.length>3900) throw Error('Notification payload too large');
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aesKey,plaintext));
  const rs = Uint8Array.of(0,0,16,0,65); // record size 4096, key id length 65
  return concat(salt,rs,ephPublic,cipher);
}
async function vapidHeader(endpoint, env) {
  const publicRaw = unb64u(env.VAPID_PUBLIC_KEY || '');
  const secretRaw = unb64u(env.VAPID_PRIVATE_KEY || '');
  if(publicRaw.length!==65 || secretRaw.length!==32) throw Error('VAPID keys not configured');
  const jwk = {kty:'EC',crv:'P-256',x:b64u(publicRaw.slice(1,33)),y:b64u(publicRaw.slice(33)),d:b64u(secretRaw)};
  const key = await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const payload = {aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:env.VAPID_SUBJECT};
  if(!payload.sub || !(payload.sub.startsWith('mailto:') || payload.sub.startsWith('https://'))) throw Error('VAPID_SUBJECT missing');
  const unsigned = b64u(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+b64u(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}
async function sendNotification(subscription, message, env) {
  if(!validSubscription(subscription)) return false;
  const [body, auth] = await Promise.all([encryptWebPush(subscription,message),vapidHeader(subscription.endpoint,env)]);
  const response = await fetch(subscription.endpoint,{method:'POST',headers:{
    Authorization:auth, TTL:'3600', Urgency:'high', 'Content-Encoding':'aes128gcm', 'Content-Type':'application/octet-stream'
  },body});
  if(response.status===404 || response.status===410) return false;
  if(!response.ok) throw Error(`Push service rejected request (${response.status})`);
  return true;
}
const reminderBody = m => ({
  title: m.kind === 'Interview' ? 'JobPilot interview reminder' : 'JobPilot schedule reminder',
  body: m.milestone===1440 ? 'An upcoming event starts in about 24 hours.' :
        m.milestone===60 ? 'An upcoming event starts in about 1 hour.' :
        'An upcoming event starts in about 15 minutes.',
  url:'./?open=calendar', tag:`jobpilot-${m.source}-${m.event_id}-${m.milestone}`
});
async function deliverAll(env, payload) {
  const devices = (await env.DB.prepare('SELECT endpoint, subscription FROM devices ORDER BY updated_at DESC LIMIT 5').all()).results || [];
  let sent=0, transient=0;
  for(const device of devices) {
    try {
      const ok = await sendNotification(JSON.parse(device.subscription),payload,env);
      if(ok) sent++;
      else await env.DB.prepare('DELETE FROM devices WHERE endpoint=?').bind(device.endpoint).run();
    } catch(e) { transient++; console.error('Push delivery failed:',e.message); }
  }
  return {sent,transient,devices:devices.length};
}
async function syncReminders(env, data) {
  const source = data.source;
  if(!['planner','yahoo'].includes(source) || !Array.isArray(data.reminders) || data.reminders.length>600) throw Error('Invalid reminder sync');
  const now=Date.now(), revision=crypto.randomUUID();
  const statements=[];
  const seen=new Set();
  for(const r of data.reminders) {
    if(typeof r.id!=='string' || !/^[\w:.-]{1,125}$/.test(r.id) ||
      ![1440,60,15].includes(r.milestone) ||
      !['Interview','Follow-up','Deadline','Other'].includes(r.kind) ||
      !Number.isSafeInteger(r.eventAt) || !Number.isSafeInteger(r.fireAt) ||
      r.fireAt!==r.eventAt-r.milestone*60000 ||
      r.eventAt < now-86400000 || r.eventAt > now+366*86400000) throw Error('Invalid reminder record');
    const id = `${r.id}:${r.milestone}`;
    if(seen.has(id)) continue; seen.add(id);
    statements.push(env.DB.prepare(`INSERT INTO reminders (source,event_id,milestone,fire_at,event_at,kind,revision,sent_at)
      VALUES (?,?,?,?,?,?,?,NULL)
      ON CONFLICT(source,event_id,milestone) DO UPDATE SET
      fire_at=excluded.fire_at,event_at=excluded.event_at,kind=excluded.kind,revision=excluded.revision,
      sent_at=CASE WHEN reminders.fire_at=excluded.fire_at AND reminders.event_at=excluded.event_at THEN reminders.sent_at ELSE NULL END`)
      .bind(source,r.id,r.milestone,r.fireAt,r.eventAt,r.kind,revision));
  }
  statements.push(env.DB.prepare('DELETE FROM reminders WHERE source=? AND revision<>?').bind(source,revision));
  await env.DB.batch(statements);
  return {count:seen.size};
}
async function runReminders(env) {
  const now=Date.now();
  const due = (await env.DB.prepare(`SELECT source,event_id,milestone,fire_at,event_at,kind FROM reminders
    WHERE sent_at IS NULL AND fire_at<=? AND event_at>? AND fire_at>? ORDER BY fire_at ASC LIMIT 25`)
    .bind(now,now,now-86400000).all()).results || [];
  for(const r of due) {
    const result=await env.DB.prepare('UPDATE reminders SET sent_at=? WHERE source=? AND event_id=? AND milestone=? AND sent_at IS NULL')
      .bind(now,r.source,r.event_id,r.milestone).run();
    if(!result.meta?.changes) continue;
    // Same calendar invitation can arrive from Yahoo and the phone's local planner.
    // Mark both sources at once to avoid duplicate notifications.
    if(r.event_id.startsWith('mail:')) await env.DB.prepare('UPDATE reminders SET sent_at=? WHERE event_id=? AND milestone=? AND fire_at=? AND sent_at IS NULL')
      .bind(now,r.event_id,r.milestone,r.fire_at).run();
    const delivered=await deliverAll(env,reminderBody(r));
    if(!delivered.sent && delivered.transient) {
      await env.DB.prepare('UPDATE reminders SET sent_at=NULL WHERE event_id=? AND milestone=? AND fire_at=? AND sent_at=?')
        .bind(r.event_id,r.milestone,r.fire_at,now).run();
    }
  }
  await env.DB.prepare('DELETE FROM reminders WHERE event_at<?').bind(now-7*86400000).run();
}
export default {
  async fetch(request,env) {
    const headers=cors(request,env);
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    const url = new URL(request.url);
    if(url.pathname==='/health' && request.method==='GET') return json({ok:true,service:'JobPilot reminders'},200,headers);
    if(url.pathname==='/config' && request.method==='GET') return json({vapidPublicKey:env.VAPID_PUBLIC_KEY||'',configured:Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)},200,headers);
    if(!['/subscribe','/unsubscribe','/reminders','/test'].includes(url.pathname)) return json({error:'Not found'},404,headers);
    if(request.headers.get('Origin') && request.headers.get('Origin')!==allowedOrigin(env)) return json({error:'Invalid origin'},403,headers);
    if(!(await isAuthorized(request,env))) return json({error:'Unauthorized'},401,headers);
    if(!env.DB) return json({error:'Database binding not configured'},503,headers);
    let data={};
    if(['POST','PUT'].includes(request.method)) {
      try { if(Number(request.headers.get('Content-Length'))>100000) throw Error('Payload too large'); data=await request.json(); }
      catch { return json({error:'Invalid JSON body'},400,headers); }
    }
    try {
      if(url.pathname==='/subscribe' && request.method==='POST') {
        if(!validSubscription(data.subscription)) throw Error('Invalid browser push subscription');
        await env.DB.prepare('INSERT INTO devices(endpoint,subscription,updated_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription,updated_at=excluded.updated_at')
          .bind(data.subscription.endpoint,JSON.stringify(data.subscription),Date.now()).run();
        return json({ok:true},200,headers);
      }
      if(url.pathname==='/unsubscribe' && request.method==='POST') {
        if(typeof data.endpoint!=='string' || !validPushEndpoint(data.endpoint)) throw Error('Invalid endpoint');
        await env.DB.prepare('DELETE FROM devices WHERE endpoint=?').bind(data.endpoint).run();
        return json({ok:true},200,headers);
      }
      if(url.pathname==='/reminders' && request.method==='PUT') {
        const result=await syncReminders(env,data);
        return json({ok:true,...result},200,headers);
      }
      if(url.pathname==='/test' && request.method==='POST') {
        const ts=Date.now();
        const previous=await env.DB.prepare("SELECT value FROM metadata WHERE key='last_test'").first();
        if(previous && ts-Number(previous.value)<30000) return json({error:'Please wait 30 seconds before testing again.'},429,headers);
        await env.DB.prepare("INSERT INTO metadata(key,value) VALUES('last_test',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .bind(String(ts)).run();
        const outcome=await deliverAll(env,{title:'JobPilot notifications enabled',body:'This test was sent from the cloud, even if JobPilot was closed.',url:'./?open=calendar',tag:'jobpilot-test'});
        return json({ok:true,delivered:outcome.sent,failed:outcome.transient},200,headers);
      }
      return json({error:'Method not allowed'},405,headers);
    } catch(e) {
      console.error('Request error:',e.message);
      return json({error:e.message==='Invalid reminder record'||e.message==='Invalid reminder sync'||e.message.includes('Invalid')?e.message:'Push service unavailable. Check server configuration.'},400,headers);
    }
  },
  async scheduled(_event,env,ctx) { ctx.waitUntil(runReminders(env)); }
};
export const testHelpers={b64u,unb64u,encryptWebPush,vapidHeader,validSubscription,validPushEndpoint,reminderBody,syncReminders};