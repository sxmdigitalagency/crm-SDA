import { authConfigured, hasValidSession } from './lib/auth';
import { error, HttpError } from './lib/http';
import type { Handler } from './lib/types';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/status']);
const PUBLIC_PAGES = ['/login', '/css/', '/js/', '/assets/', '/favicon'];

function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

export const onRequest: Handler = async (context) => {
  const url = new URL(context.request.url);
  const isApi = url.pathname.startsWith('/api/');

  try {
    if (!authConfigured(context.env)) {
      // Sans identifiants configurés, on n'ouvre l'accès qu'en local — jamais en production.
      if (!isLocal(url)) return error(503, 'Authentification non configurée (ADMIN_EMAIL / ADMIN_PASSWORD_HASH)');
      return await context.next();
    }

    const isPublic = isApi ? PUBLIC_PATHS.has(url.pathname) : PUBLIC_PAGES.some((p) => url.pathname.startsWith(p));
    if (isPublic || (await hasValidSession(context.env, context.request))) {
      return await context.next();
    }
    if (isApi) return error(401, 'Non authentifié');
    return Response.redirect(new URL(`/login/?next=${encodeURIComponent(url.pathname + url.search)}`, url).toString(), 302);
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message);
    console.error(err);
    return error(500, 'Erreur serveur');
  }
};
