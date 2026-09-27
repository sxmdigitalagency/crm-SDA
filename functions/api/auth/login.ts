import { authConfigured, createSession, verifyPassword } from '../../lib/auth';
import { error, json, readJson, str } from '../../lib/http';
import type { Handler } from '../../lib/types';

const MAX_FAILURES = 10;
const WINDOW = '-15 minutes';

export const onRequestPost: Handler = async ({ request, env }) => {
  if (!authConfigured(env)) return error(503, 'Authentification non configurée');
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > datetime('now', '${WINDOW}')`,
  ).bind(ip).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILURES) {
    return error(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  }
  const body = await readJson(request);
  const email = str(body.email, 200).toLowerCase();
  const password = String(body.password ?? '');

  const emailOk = email === env.ADMIN_EMAIL!.trim().toLowerCase();
  // On vérifie toujours le mot de passe pour ne pas révéler par le temps de réponse si l'email existe.
  const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH!);
  if (!emailOk || !passwordOk) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')`),
      env.DB.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(ip),
    ]);
    await new Promise((r) => setTimeout(r, 400));
    return error(401, 'Identifiants incorrects');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();

  const cookie = await createSession(env, new URL(request.url).protocol === 'https:');
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
};
