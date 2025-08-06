// api/debug_db.js
// @ts-nocheck
import { supabase } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  if (req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    // Hacemos una consulta mínima a Supabase para verificar conexión
    const { data, error } = await supabase.rpc('version'); // invoca una función interna
    // Si no tienes funciones RPC, puedes usar un SELECT sencillo así:
    // const { data, error } = await supabase.from('stores').select('store_id').limit(1);

    if (error) {
      console.error('debug_db supabase error:', error);
      return res.status(500).json({ error: 'db_connection_failed', detail: error.message });
    }
    return res.json({ ok: true, test: data });
  } catch (e) {
    console.error('Error en debug_db:', e);
    return res.status(500).json({ error: 'db_connection_failed', detail: e.message });
  }
}