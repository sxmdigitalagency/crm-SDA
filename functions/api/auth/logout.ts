import { destroySession } from '../../lib/auth';
import { json } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestPost: Handler = async ({ request, env }) => {
  const cookie = await destroySession(env, request, new URL(request.url).protocol === 'https:');
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
};
