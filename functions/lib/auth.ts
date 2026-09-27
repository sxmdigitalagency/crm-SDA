import type { Env } from './types';

export const SESSION_COOKIE = 'sda_session';
const SESSION_DAYS = 30;
const ITERATIONS = 100_000; // plafond PBKDF2 des Workers

const enc = new TextEncoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Format : pbkdf2$<iterations>$<salt b64>$<hash b64> */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const derived = new Uint8Array(await pbkdf2(password, fromB64(salt), Number(iter)));
  const expected = fromB64(hash);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i]! ^ expected[i]!;
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function createSession(env: Env, secure: boolean): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    env.DB.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').bind(token, expires),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86_400, secure);
}

export async function destroySession(env: Env, request: Request, secure: boolean): Promise<string> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
  return sessionCookie('', 0, secure);
}

export async function hasValidSession(env: Env, request: Request): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const row = await env.DB.prepare('SELECT 1 FROM sessions WHERE id = ? AND expires_at > ?')
    .bind(token, new Date().toISOString())
    .first();
  return row !== null;
}

/** Auth désactivée quand aucun hash n'est configuré — uniquement acceptable en local. */
export function authConfigured(env: Env): boolean {
  return Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH);
}
