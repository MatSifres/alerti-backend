// @ts-nocheck
import { getClient } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const incomingSecret = req.headers['x-shared-secret'];
  if (incomingSecret && incomingSecret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { store_id: raw_store_id, access_token } = req.body;
  const store_id = normalizeId(raw_store_id);
  if (!store_id || !access_token) return res.status(400).json({ error: 'Faltan store_id o access_token' });
  const now = Date.now();
  try {
    const client = await getClient();
    await client.query(
      "INSERT INTO stores (store_id, access_token, created_at) VALUES ($1, $2, $3) " +
      "ON CONFLICT (store_id) DO UPDATE SET access_token = EXCLUDED.access_token, created_at = EXCLUDED.created_at",
      [store_id, access_token, now]
    );
    return res.json({ ok: true, message: 'Tienda registrada' });
  } catch (e) {
    console.error('Error registrando tienda:', e);
    return res.status(500).json({ error: 'no se pudo registrar' });
  }
}