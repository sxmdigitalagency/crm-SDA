import { CLIENT_LABEL_SQL, getSettings, parseCurrency } from '../../lib/documents';
import { json } from '../../lib/http';
import type { Handler } from '../../lib/types';

/**
 * Agrégats du tableau de bord en un seul appel.
 * Les variations comparent le mois en cours au MÊME nombre de jours du mois précédent
 * (du 1er au jour J), pour ne pas opposer un mois partiel à un mois complet.
 */
export const onRequestGet: Handler = async ({ env, request }) => {
  const db = env.DB;
  // Les montants de devises différentes ne s'additionnent jamais : tout est filtré sur UNE devise.
  const settings = await getSettings(db);
  const cur = parseCurrency(new URL(request.url).searchParams.get('currency'), settings.default_currency);
  const now = new Date();
  const day = now.getUTCDate();
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  const prevEnd = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), Math.min(day, prevDays)));
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const today = d(now);
  const periods = [d(curStart), today, d(prevStart), d(prevEnd)] as const;

  const results = await db.batch([
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN issue_date BETWEEN ?1 AND ?2 THEN total END), 0) AS cur,
              COALESCE(SUM(CASE WHEN issue_date BETWEEN ?3 AND ?4 THEN total END), 0) AS prev
       FROM invoices WHERE status IN ('issued', 'paid') AND currency = ?5`,
    ).bind(...periods, cur),
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN paid_at BETWEEN ?1 AND ?2 THEN amount END), 0) AS cur,
              COALESCE(SUM(CASE WHEN paid_at BETWEEN ?3 AND ?4 THEN amount END), 0) AS prev
       FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.status <> 'cancelled' AND i.currency = ?5`,
    ).bind(...periods, cur),
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN issue_date BETWEEN ?1 AND ?2 THEN subtotal END), 0) AS cur,
              COALESCE(SUM(CASE WHEN issue_date BETWEEN ?3 AND ?4 THEN subtotal END), 0) AS prev,
              COUNT(CASE WHEN issue_date BETWEEN ?1 AND ?2 THEN 1 END) AS count
       FROM quotes WHERE status <> 'draft' AND currency = ?5`,
    ).bind(...periods, cur),
    // Taux de transformation sur 12 mois glissants, hors devis encore en attente de réponse.
    db.prepare(
      `SELECT COUNT(CASE WHEN status IN ('accepted', 'converted') THEN 1 END) AS won,
              COUNT(CASE WHEN status IN ('accepted', 'converted', 'declined') OR (status = 'sent' AND valid_until < date('now')) THEN 1 END) AS decided
       FROM quotes WHERE issue_date >= date('now', '-12 months')`,
    ),
    db.prepare(
      `SELECT COALESCE(SUM(total - amount_paid), 0) AS amount,
              COALESCE(SUM(CASE WHEN due_date < date('now') THEN total - amount_paid END), 0) AS overdue,
              COUNT(CASE WHEN due_date < date('now') THEN 1 END) AS overdue_count,
              COUNT(*) AS count
       FROM invoices WHERE status = 'issued' AND currency = ?1`,
    ).bind(cur),
    db.prepare(
      `SELECT COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
              COUNT(CASE WHEN status = 'prospect' THEN 1 END) AS prospects,
              COUNT(CASE WHEN created_at >= ?1 THEN 1 END) AS new_this_month
       FROM clients WHERE anonymized_at IS NULL`,
    ).bind(periods[0]),
    db.prepare(
      `SELECT COALESCE(SUM(subtotal), 0) AS amount, COUNT(*) AS count
       FROM quotes WHERE status = 'sent' AND valid_until >= date('now') AND currency = ?1`,
    ).bind(cur),
    // 12 derniers mois, mois vides inclus (CTE récursive).
    db.prepare(
      `WITH RECURSIVE months(m, n) AS (
         SELECT strftime('%Y-%m', 'now', 'start of month', '-11 months'), 0
         UNION ALL SELECT strftime('%Y-%m', m || '-01', '+1 month'), n + 1 FROM months WHERE n < 11
       )
       SELECT m AS month,
         COALESCE((SELECT SUM(total) FROM invoices WHERE status IN ('issued','paid') AND currency = ?1 AND strftime('%Y-%m', issue_date) = m), 0) AS invoiced,
         COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id
                   WHERE i.status <> 'cancelled' AND i.currency = ?1 AND strftime('%Y-%m', p.paid_at) = m), 0) AS collected,
         COALESCE((SELECT SUM(subtotal) FROM quotes WHERE status <> 'draft' AND currency = ?1 AND strftime('%Y-%m', issue_date) = m), 0) AS quoted
       FROM months ORDER BY m`,
    ).bind(cur),
    db.prepare(
      `SELECT COALESCE(s.category, 'Hors catalogue') AS category, SUM(li.amount) AS amount
       FROM line_items li
       JOIN invoices i ON li.document_type = 'invoice' AND i.id = li.document_id
       LEFT JOIN services s ON s.id = li.service_id
       WHERE i.status IN ('issued', 'paid') AND i.currency = ?1 AND i.issue_date >= date('now', '-12 months')
       GROUP BY 1 HAVING SUM(li.amount) > 0 ORDER BY 2 DESC`,
    ).bind(cur),
    db.prepare(
      `SELECT i.id, i.number, i.due_date, i.total - i.amount_paid AS remaining, ${CLIENT_LABEL_SQL} AS client_label,
              CAST(julianday(i.due_date) - julianday('now', 'start of day') AS INTEGER) AS days
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.status = 'issued' AND i.currency = ?1 ORDER BY i.due_date LIMIT 6`,
    ).bind(cur),
    db.prepare(
      `SELECT * FROM (
         SELECT 'quote' AS kind, q.id, q.number AS ref, q.subtotal AS amount, q.currency, q.created_at AS at, ${CLIENT_LABEL_SQL} AS client_label
           FROM quotes q JOIN clients c ON c.id = q.client_id
         UNION ALL
         SELECT 'invoice', i.id, i.number, i.total, i.currency, i.updated_at, ${CLIENT_LABEL_SQL}
           FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.status IN ('issued', 'paid')
         UNION ALL
         SELECT 'payment', i.id, i.number, p.amount, i.currency, p.created_at, ${CLIENT_LABEL_SQL}
           FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
         UNION ALL
         SELECT 'client', c.id, NULL, NULL, NULL, c.created_at, ${CLIENT_LABEL_SQL}
           FROM clients c WHERE c.anonymized_at IS NULL
       ) ORDER BY at DESC LIMIT 8`,
    ),
    db.prepare(
      `SELECT currency FROM invoices WHERE status <> 'draft' UNION SELECT currency FROM quotes UNION SELECT ?1`,
    ).bind(settings.default_currency),
  ]);

  const [invoiced, collected, quoted, conversion, outstanding, clients, pipeline, monthly, categories, due, activity, currencies] =
    results.map((r) => r.results);
  const first = <T>(rows: unknown[] | undefined) => (rows?.[0] ?? {}) as T;
  const conv = first<{ won: number; decided: number }>(conversion);

  return json({
    generated_at: new Date().toISOString(),
    currency: cur,
    currencies: (currencies ?? []).map((r) => (r as { currency: string }).currency).sort(),
    period: { current_from: periods[0], current_to: periods[1], previous_from: periods[2], previous_to: periods[3] },
    kpis: {
      invoiced: first(invoiced),
      collected: first(collected),
      quoted: first(quoted),
      conversion: { won: conv.won ?? 0, decided: conv.decided ?? 0, rate: conv.decided ? conv.won / conv.decided : null },
      outstanding: first(outstanding),
      clients: first(clients),
      pipeline: first(pipeline),
    },
    monthly: monthly ?? [],
    categories: categories ?? [],
    due: due ?? [],
    activity: activity ?? [],
  });
};
