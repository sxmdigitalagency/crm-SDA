import { HttpError, oneOf, str } from './http';

export const CLIENT_FIELDS = [
  'company_name', 'first_name', 'last_name', 'email', 'phone', 'address',
  'postal_code', 'city', 'country', 'siret', 'vat_number', 'notes',
] as const;

export function parseClient(body: Record<string, unknown>) {
  const data: Record<string, string> = {};
  for (const f of CLIENT_FIELDS) data[f] = str(body[f], f === 'notes' ? 5000 : 300);
  const type = oneOf(body.type, ['pro', 'particulier'] as const, 'pro');
  const status = oneOf(body.status, ['prospect', 'active', 'inactive'] as const, 'prospect');
  if (!data.company_name && !data.last_name) throw new HttpError(400, 'Nom ou raison sociale requis');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, 'Email invalide');
  if (!data.country) data.country = 'France';
  return { ...data, type, status };
}
