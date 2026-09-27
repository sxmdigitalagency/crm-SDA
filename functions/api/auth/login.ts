import { authConfigured, createSession, verifyPassword } from '../../lib/auth';
import { error, json, readJson, str } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestPost: Handler = async ({ request, env }) => {
  if (!authConfigured(env)) return error(503, 'Authentification non configurée');
  const body = await readJson(request);
  const email = str(body.email, 200).toLowerCase();
  const password = String(body.password ?? '');

  const emailOk = email === env.ADMIN_EMAIL!.trim().toLowerCase();
  // On vérifie toujours le mot de passe pour ne pas révéler par le temps de réponse si l'email existe.
  const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH!);
  if (!emailOk || !passwordOk) {
    await new Promise((r) => setTimeout(r, 400));
    return error(401, 'Identifiants incorrects');
  }

  const cookie = await createSession(env, new URL(request.url).protocol === 'https:');
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
};
