// @ts-nocheck
import { getClient } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  const secret = req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const client = await getClient();
    const result = await client.query('SELECT 1 AS result');
    return res.json({ ok: true, result: result.rows[0].result });
  } catch (e) {
    console.error('Error en debug_db:', e);
    return res.status(500).json({ error: 'db_connection_failed', detail: e.message });
  }
}