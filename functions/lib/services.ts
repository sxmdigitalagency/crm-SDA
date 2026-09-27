import { HttpError, oneOf, str } from './http';

export function parseService(body: Record<string, unknown>) {
  const name = str(body.name, 200);
  if (!name) throw new HttpError(400, 'Nom de la prestation requis');
  const unit_price = Math.round(Number(body.unit_price ?? 0));
  if (!Number.isFinite(unit_price) || unit_price < 0) throw new HttpError(400, 'Prix invalide');
  return {
    category: str(body.category, 60) || 'Autre',
    name,
    description: str(body.description, 2000),
    unit: oneOf(body.unit, ['forfait', 'heure', 'jour', 'mois', 'unité'] as const, 'forfait'),
    unit_price,
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}
