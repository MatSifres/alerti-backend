// api/register_store.js
// @ts-nocheck
import { supabase } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const incomingSecret = req.headers['x-shared-secret'];
  if (incomingSecret && incomingSecret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { store_id: raw_store_id, access_token } = req.body;
  const store_id = normalizeId(raw_store_id);
  if (!store_id || !access_token) {
    return res.status(400).json({ error: 'Faltan store_id o access_token' });
  }

  const now = Date.now();
  const { error } = await supabase
    .from('stores')
    .upsert({ store_id, access_token, created_at: now }, { onConflict: 'store_id' });

  if (error) {
    console.error('Supabase upsert stores error:', error);
    return res.status(500).json({ error: 'db_error', detail: error.message });
  }

  return res.json({ ok: true, message: 'Tienda registrada' });
}