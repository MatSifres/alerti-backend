// @ts-nocheck
import { getClient } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  const secret = req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const client = await getClient();
    const result = await client.query(
      "SELECT store_id, substring(access_token from 1 for 10) || '...' AS token_preview, created_at " +
      "FROM stores"
    );
    const formatted = result.rows.map(r => ({
      store_id: r.store_id,
      access_token_preview: r.token_preview,
      created_at: new Date(Number(r.created_at)).toISOString()
    }));
    res.json({ stores: formatted });
  } catch (e) {
    console.error('debug stores error', e);
    res.status(500).json({ error: 'internal' });
  }
}