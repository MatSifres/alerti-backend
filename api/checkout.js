// @ts-nocheck
import { getClient } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  let { store_id: raw_store_id, cart_url } = req.body;
  let order_id = req.body.order_id || req.body.checkout_id;
  const store_id = normalizeId(raw_store_id);
  order_id = normalizeId(order_id);
  if (!store_id || !order_id || !cart_url) {
    return res.status(400).json({ error: 'Faltan store_id, order_id o cart_url' });
  }

  const now = Date.now();
  const checkAfter = now + 60 * 60 * 1000; // 60 minutos

  try {
    const client = await getClient();
    await client.query(
      "INSERT INTO checkouts (checkout_id, store_id, cart_url, created_at, check_after) " +
      "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (checkout_id) DO NOTHING",
      [order_id, store_id, cart_url, now, checkAfter]
    );
    return res.json({ ok: true, scheduled_for: new Date(checkAfter).toISOString() });
  } catch (e) {
    console.error('Error guardando checkout:', e);
    return res.status(500).json({ error: 'falló guardar' });
  }
}