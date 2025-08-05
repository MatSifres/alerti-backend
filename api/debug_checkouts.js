// api/debug_checkouts.js
// @ts-nocheck
import { supabase } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  if (req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const storeFilter = req.query.store_id ? normalizeId(req.query.store_id) : null;
  const statusFilter = req.query.status || null;

  let query = supabase
    .from('checkouts')
    .select('checkout_id, store_id, cart_url, status, created_at, check_after, processed_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (storeFilter) query = query.eq('store_id', storeFilter);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;

  if (error) {
    console.error('Supabase select checkouts error:', error);
    return res.status(500).json({ error: 'db_error', detail: error.message });
  }

  const formatted = data.map(r => ({
    checkout_id: r.checkout_id,
    store_id: r.store_id,
    cart_url: r.cart_url,
    status: r.status,
    created_at: new Date(Number(r.created_at)).toISOString(),
    check_after: new Date(Number(r.check_after)).toISOString(),
    processed_at: r.processed_at ? new Date(Number(r.processed_at)).toISOString() : null
  }));

  res.json({ checkouts: formatted });
}