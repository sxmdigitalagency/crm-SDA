import { error } from '../lib/http';
import type { Handler } from '../lib/types';

// Toute route /api inconnue répond 404 en JSON, au lieu de la page HTML de l'application.
export const onRequest: Handler = async () => error(404, 'Route API inconnue');
