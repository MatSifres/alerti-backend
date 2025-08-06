// api/run-pending.js
// @ts-nocheck
import { supabase } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  // CORS / método
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // Autorización
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const now = Date.now();

  // 1) Traer pendientes cuyo check_after ya pasó
  const { data: pendings, error: pendErr } = await supabase
    .from('checkouts')
    .select('*')
    .eq('status', 'pending')
    .lte('check_after', now);

  if (pendErr) {
    console.error('Error al leer pendientes:', pendErr);
    return res.status(500).json({ error: 'db_error', detail: pendErr.message });
  }

  let processedCount = 0;

  for (const row of pendings) {
    const checkout_id = normalizeId(row.checkout_id);
    const store_id    = normalizeId(row.store_id);
    const cart_url    = row.cart_url;
    console.log(`[worker] procesando ${checkout_id} de store ${store_id}`);

    // 2) Obtener access_token
    const { data: storeData, error: storeErr } = await supabase
      .from('stores')
      .select('access_token')
      .eq('store_id', store_id)
      .single();
    if (storeErr || !storeData?.access_token) {
      console.warn(`No access_token para store ${store_id}`);
      continue;
    }
    const accessToken = storeData.access_token;

    // 3) Consultar TiendaNube
    let orderData;
    try {
      const resp = await fetch(
        `https://api.tiendanube.com/v1/${store_id}/orders/${checkout_id}?fields=completed_at,contact_phone`,
        {
          method: 'GET',
          headers: {
            'Authentication': `bearer ${accessToken}`,
            'User-Agent': 'Alerti: (contacto@alerti.app)'
          }
        }
      );
      if (!resp.ok) {
        console.warn(`TiendaNube devolvió ${resp.status} para ${checkout_id}`);
        // Marcar error técnico en TiendaNube para no reintentar
        await supabase
          .from('checkouts')
          .update({ status: 'error', processed_at: now })
          .eq('checkout_id', checkout_id);
        processedCount++;
        continue;
      }
      orderData = await resp.json();
    } catch (err) {
      console.error('Error fetch Tiendanube:', err);
      await supabase
        .from('checkouts')
        .update({ status: 'error', processed_at: now })
        .eq('checkout_id', checkout_id);
      processedCount++;
      continue;
    }

    // 4) Verificar si convertido
    let completedRaw = null;
    if (orderData.completed_at) {
      completedRaw = typeof orderData.completed_at === 'string'
        ? orderData.completed_at
        : orderData.completed_at.date;
    }
    const sentinel = '-0001-11-30 00:00:00.000000';
    const converted = completedRaw && completedRaw.trim() !== sentinel;
    if (converted) {
      await supabase
        .from('checkouts')
        .update({ status: 'converted', processed_at: now })
        .eq('checkout_id', checkout_id);
      console.log(`Checkout ${checkout_id} convertido.`);
      processedCount++;
      continue;
    }

    // 5) Verificar si falta teléfono
    const phone = orderData.contact_phone ?? orderData.raw?.contact_phone;
    if (!phone || String(phone).trim() === '') {
      await supabase
        .from('checkouts')
        .update({ status: 'no_contact', processed_at: now })
        .eq('checkout_id', checkout_id);
      console.log(`Checkout ${checkout_id} no_contact.`);
      processedCount++;
      continue;
    }

    // 6) Disparar workflow en Bubble
    try {
      const bubbleUrl = 'https://dashboard.alerti.app/version-test/api/1.1/wf/render_checkout';
      const bubbleResp = await fetch(bubbleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id, order_id: checkout_id, cart_url })
      });

      if (!bubbleResp.ok) {
        console.warn(`Bubble devolvió ${bubbleResp.status} para ${checkout_id}`);
        // MARCAR ERROR y no reintentar
        await supabase
          .from('checkouts')
          .update({ status: 'error', processed_at: now })
          .eq('checkout_id', checkout_id);
        processedCount++;
        continue;
      }
      await bubbleResp.json();

      // 7) Marcar abandonado
      await supabase
        .from('checkouts')
        .update({ status: 'abandoned', processed_at: now })
        .eq('checkout_id', checkout_id);
      console.log(`Checkout ${checkout_id} abandonado.`);
      processedCount++;

    } catch (err) {
      console.error('Error posteando a Bubble:', err);
      await supabase
        .from('checkouts')
        .update({ status: 'error', processed_at: now })
        .eq('checkout_id', checkout_id);
      processedCount++;
    }
  }

  return res.json({ ok: true, processed: processedCount });
}