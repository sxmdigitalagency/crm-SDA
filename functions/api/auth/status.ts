import { authConfigured, hasValidSession } from '../../lib/auth';
import { json } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const configured = authConfigured(env);
  return json({ configured, authenticated: configured ? await hasValidSession(env, request) : true });
};
