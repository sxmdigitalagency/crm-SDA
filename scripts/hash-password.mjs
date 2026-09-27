// Génère le hash PBKDF2 à placer dans ADMIN_PASSWORD_HASH (même format que functions/lib/auth.ts).
// Usage : npm run hash-password -- "mot-de-passe"
import { webcrypto as crypto } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage : npm run hash-password -- "mot-de-passe" (10 caractères minimum)');
  process.exit(1);
}
const iterations = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
const b64 = (b) => Buffer.from(b).toString('base64');
console.log(`pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`);
