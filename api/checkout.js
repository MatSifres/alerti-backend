// api/checkout.js
// @ts-nocheck
import { supabase } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  // — CORS —
  res.setHeader('Access-Control-Allow-Origin', '*');            // o tu dominio: 'https://www.fuled.com.ar'
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { store_id: raw_store_id, cart_url } = req.body;
  let order_id = req.body.order_id || req.body.checkout_id;
  const store_id = normalizeId(raw_store_id);
  order_id = normalizeId(order_id);

  if (!store_id || !order_id || !cart_url) {
    return res.status(400).json({ error: 'Faltan store_id, order_id o cart_url' });
  }

  const now = Date.now();
  const checkAfter = now + 60 * 60 * 1000; // 60 minutos

  const { error } = await supabase
    .from('checkouts')
    .insert(
      { checkout_id: order_id, store_id, cart_url, created_at: now, check_after: checkAfter },
      { ignoreDuplicates: true }
    );

  if (error) {
    console.error('Supabase insert checkouts error:', error);
    return res.status(500).json({ error: 'db_error', detail: error.message });
  }

  return res.json({ ok: true, scheduled_for: new Date(checkAfter).toISOString() });
}