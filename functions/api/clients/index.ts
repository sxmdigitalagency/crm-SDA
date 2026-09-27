import { CLIENT_FIELDS, parseClient } from '../../lib/clients';
import { CLIENT_LABEL_SQL } from '../../lib/documents';
import { json, readJson, str } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const url = new URL(request.url);
  const q = str(url.searchParams.get('q'), 100);
  const type = url.searchParams.get('type');
  const status = url.searchParams.get('status');

  const where = ['c.anonymized_at IS NULL'];
  const params: unknown[] = [];
  if (q) {
    where.push(`(c.company_name LIKE ?1 OR c.first_name LIKE ?1 OR c.last_name LIKE ?1 OR c.email LIKE ?1 OR c.phone LIKE ?1 OR c.city LIKE ?1)`);
    params.push(`%${q}%`);
  }
  if (type === 'pro' || type === 'particulier') { where.push(`c.type = ?${params.length + 1}`); params.push(type); }
  if (status === 'prospect' || status === 'active' || status === 'inactive') { where.push(`c.status = ?${params.length + 1}`); params.push(status); }

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.type, c.status, c.company_name, c.first_name, c.last_name, c.email, c.phone, c.city, c.created_at,
       ${CLIENT_LABEL_SQL} AS label,
       COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.client_id = c.id AND i.status IN ('issued','paid')), 0) AS invoiced,
       COALESCE((SELECT SUM(i.amount_paid) FROM invoices i WHERE i.client_id = c.id AND i.status IN ('issued','paid')), 0) AS paid,
       (SELECT COUNT(*) FROM quotes qq WHERE qq.client_id = c.id) AS quote_count,
       (SELECT MAX(d) FROM (SELECT MAX(updated_at) AS d FROM quotes WHERE client_id = c.id
                            UNION ALL SELECT MAX(updated_at) FROM invoices WHERE client_id = c.id)) AS last_activity
     FROM clients c WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(last_activity, c.created_at) DESC LIMIT 500`,
  ).bind(...params).all();
  return json(results);
};

export const onRequestPost: Handler = async ({ request, env }) => {
  const c = parseClient(await readJson(request));
  const cols = ['type', 'status', ...CLIENT_FIELDS];
  const row = await env.DB.prepare(
    `INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`,
  ).bind(...cols.map((k) => c[k as keyof typeof c])).first<{ id: number }>();
  return json({ id: row!.id }, { status: 201 });
};
