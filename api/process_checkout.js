// api/process_checkout.js
// @ts-nocheck
import { supabase } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  // CORS + método
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Auth
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Parámetro obligatorio
  const raw = req.body.checkout_id || req.body.order_id;
  if (!raw) {
    return res.status(400).json({ error: 'checkout_id (o order_id) es requerido' });
  }
  const checkout_id = normalizeId(raw);
  const now = Date.now();

  // Actualizar check_after para que sea <= now
  const { error: updateErr } = await supabase
    .from('checkouts')
    .update({ check_after: now })
    .eq('checkout_id', checkout_id);

  if (updateErr) {
    console.error('Error actualizando check_after:', updateErr);
    return res.status(500).json({ error: 'db_error', detail: updateErr.message });
  }

  // Respuesta JSON limpia
  return res.json({
    ok: true,
    checkout_id,
    new_check_after: now,
    new_scheduled_for: new Date(now).toISOString()
  });
}