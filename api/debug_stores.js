// api/debug_stores.js
// @ts-nocheck
import { supabase } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  if (req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { data, error } = await supabase
    .from('stores')
    .select('store_id, access_token, created_at');

  if (error) {
    console.error('Supabase select stores error:', error);
    return res.status(500).json({ error: 'db_error', detail: error.message });
  }

  const formatted = data.map(r => ({
    store_id: r.store_id,
    access_token_preview: r.access_token.substring(0,10) + '...',
    created_at: new Date(Number(r.created_at)).toISOString()
  }));

  res.json({ stores: formatted });
}