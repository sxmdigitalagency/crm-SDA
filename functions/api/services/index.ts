import { json, readJson } from '../../lib/http';
import { parseService } from '../../lib/services';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const all = new URL(request.url).searchParams.get('all') === '1';
  const { results } = await env.DB.prepare(
    `SELECT * FROM services ${all ? '' : 'WHERE active = 1'} ORDER BY category, name`,
  ).all();
  return json(results);
};

export const onRequestPost: Handler = async ({ request, env }) => {
  const s = parseService(await readJson(request));
  const row = await env.DB.prepare(
    'INSERT INTO services (category, name, description, unit, unit_price, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(s.category, s.name, s.description, s.unit, s.unit_price, s.active).first<{ id: number }>();
  return json({ id: row!.id }, { status: 201 });
};
