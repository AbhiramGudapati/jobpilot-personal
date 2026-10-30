import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, generateKeyPairSync } from 'node:crypto';
import worker, {testHelpers as h} from '../index.mjs';
if(!globalThis.crypto) globalThis.crypto=webcrypto;
const enc = new TextEncoder();
const unb64u = h.unb64u;
const concat=(...items)=>Buffer.concat(items.map(b=>Buffer.from(b)));
async function hmac(key, bytes) {
  const imported=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',imported,bytes));
}
async function expand(prk, info, n) {return (await hmac(prk,concat(info,Buffer.from([1])))).slice(0,n);}

test('invalid push endpoints are rejected',()=>{
  assert.equal(h.validPushEndpoint('http://fcm.googleapis.com/x'),false);
  assert.equal(h.validPushEndpoint('https://127.0.0.1:443/test'),false);
  assert.equal(h.validPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'),true);
  assert.equal(h.validPushEndpoint('https://web.push.apple.com/QAAAA'),true);
  assert.equal(h.validPushEndpoint('https://fake.push.apple.com.attacker.com/x'),false);
});

test('payload is RFC8291 decryptable with receiver ECDH key', async()=>{
  const recipient=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const publicKey=await crypto.subtle.exportKey('raw',recipient.publicKey);
  const auth=crypto.getRandomValues(new Uint8Array(16));
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:h.b64u(publicKey),auth:h.b64u(auth)}};
  assert(h.validSubscription(subscription));
  const packet=await h.encryptWebPush(subscription,{title:'JobPilot',body:'A test reminder'});
  const salt=packet.slice(0,16);
  assert.deepEqual([...packet.slice(16,21)],[0,0,16,0,65]);
  const senderRaw=packet.slice(21,86);
  const sender=await crypto.subtle.importKey('raw',senderRaw,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:sender},recipient.privateKey,256));
  const keyPrk=await hmac(auth,shared);
  const ikm=await expand(keyPrk,concat(enc.encode('WebPush: info\0'),new Uint8Array(publicKey),senderRaw),32);
  const prk=await hmac(salt,ikm);
  const cek=await expand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await expand(prk,enc.encode('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']);
  const plain=Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,packet.slice(86)));
  assert.equal(plain.at(-1),2);
  assert.deepEqual(JSON.parse(plain.subarray(0,-1).toString()),{title:'JobPilot',body:'A test reminder'});
});

test('VAPID JWT can be verified with public key',async()=>{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=pair.privateKey.export({format:'jwk'});
  const pub=concat([4],unb64u(jwk.x),unb64u(jwk.y));
  const env={VAPID_PUBLIC_KEY:h.b64u(pub),VAPID_PRIVATE_KEY:jwk.d,VAPID_SUBJECT:'mailto:test@example.com'};
  const auth=await h.vapidHeader('https://web.push.apple.com/ABCDE',env);
  const jwt=auth.match(/vapid t=([^,]+), k=/)?.[1];assert(jwt);
  const [hdr,claims,sig]=jwt.split('.');
  const payload=JSON.parse(Buffer.from(unb64u(claims)).toString());
  assert.equal(payload.aud,'https://web.push.apple.com');
  assert.equal(payload.sub,'mailto:test@example.com');
  const key=await crypto.subtle.importKey('raw',pub,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64u(sig),enc.encode(`${hdr}.${claims}`)),true);
});

test('no authentication rejects secret APIs',async()=>{
  const env={PUSH_API_TOKEN:'a'.repeat(64),ALLOWED_ORIGIN:'https://example.github.io'};
  const r=await worker.fetch(new Request('https://worker.workers.dev/reminders',{method:'PUT',body:'{}',headers:{Origin:'https://example.github.io'}}),env);
  assert.equal(r.status,401);
});

test('browser origin is normalized and included in CORS headers',async()=>{
  const env={PUSH_API_TOKEN:'a'.repeat(64),ALLOWED_ORIGIN:'https://AbhiramGudapati.github.io'};
  const origin='https://abhiramgudapati.github.io';
  const response=await worker.fetch(new Request('https://jobpilot-personal-push.workers.dev/reminders',{method:'PUT',headers:{Origin:origin}}),env);
  assert.equal(response.status,401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  const rejected=await worker.fetch(new Request('https://jobpilot-personal-push.workers.dev/reminders',{method:'PUT',headers:{Origin:'https://evil.example'}}),env);
  assert.equal(rejected.status,403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'),null);
});