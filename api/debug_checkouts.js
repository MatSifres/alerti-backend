// @ts-nocheck
import { getClient } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  const secret = req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });

  const storeFilter = req.query.store_id ? normalizeId(req.query.store_id) : null;
  const statusFilter = req.query.status ? req.query.status : null;

  let base = "SELECT checkout_id, store_id, cart_url, status, created_at, check_after, processed_at FROM checkouts";
  const conditions = [];
  const params = [];
  if (storeFilter) {
    conditions.push("store_id = $" + (params.length + 1));
    params.push(storeFilter);
  }
  if (statusFilter) {
    conditions.push("status = $" + (params.length + 1));
    params.push(statusFilter);
  }
  if (conditions.length) {
    base += " WHERE " + conditions.join(" AND ");
  }
  base += " ORDER BY created_at DESC LIMIT 100";

  try {
    const client = await getClient();
    const result = await client.query(base, params);
    const formatted = result.rows.map((r) => ({
      checkout_id: r.checkout_id,
      store_id: r.store_id,
      cart_url: r.cart_url,
      status: r.status,
      created_at: new Date(Number(r.created_at)).toISOString(),
      check_after: new Date(Number(r.check_after)).toISOString(),
      processed_at: r.processed_at ? new Date(Number(r.processed_at)).toISOString() : null
    }));
    res.json({ checkouts: formatted });
  } catch (e) {
    console.error('debug checkouts error', e);
    res.status(500).json({ error: 'internal' });
  }
}