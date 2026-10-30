import {generateKeyPairSync,randomBytes} from 'node:crypto';
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=pair.privateKey.export({format:'jwk'});
const pub = Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
console.log('VAPID_PUBLIC_KEY (Cloudflare secret):',pub);
console.log('VAPID_PRIVATE_KEY (Cloudflare secret):',jwk.d);
console.log('PUSH_API_TOKEN (Cloudflare secret + website Settings; never commit):',randomBytes(32).toString('hex'));
console.log('VAPID_SUBJECT (Cloudflare secret): mailto:YOUR-EMAIL@example.com');