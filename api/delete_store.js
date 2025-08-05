// @ts-nocheck
import { getClient } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const secret = req.query.secret || req.headers['x-debug-secret'];
  if (secret !== process.env.DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });
  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'faltan store_id' });
  const normalized = normalizeId(store_id);
  try {
    const client = await getClient();
    await client.query("DELETE FROM checkouts WHERE store_id=$1", [normalized]);
    await client.query("DELETE FROM stores WHERE store_id=$1", [normalized]);
    return res.json({ ok: true, deleted: normalized });
  } catch (e) {
    console.error('delete error', e);
    return res.status(500).json({ error: 'internal' });
  }
}