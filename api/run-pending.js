// @ts-nocheck
import { getClient } from '../lib/db.js';
import { normalizeId } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });
  const now = Date.now();
  try {
    const client = await getClient();
    const pendingRes = await client.query(
      "SELECT * FROM checkouts WHERE status = 'pending' AND check_after <= $1",
      [now]
    );
    for (const row of pendingRes.rows) {
      const checkout_id = normalizeId(row.checkout_id);
      const store_id = normalizeId(row.store_id);
      const cart_url = row.cart_url;
      console.log(`[worker] procesando ${checkout_id} de store ${store_id}`);

      // obtener access token
      let accessToken = null;
      let tokenRes = await client.query(
        "SELECT access_token FROM stores WHERE store_id = $1",
        [store_id]
      );
      if (tokenRes.rows.length) accessToken = tokenRes.rows[0].access_token;
      if (!accessToken && !store_id.endsWith('.0')) {
        const alt = await client.query(
          "SELECT access_token FROM stores WHERE store_id = $1",
          [store_id + '.0']
        );
        if (alt.rows.length) accessToken = alt.rows[0].access_token;
      }
      if (!accessToken) {
        console.warn(`No hay access_token para store_id ${store_id}, saltando`);
        continue;
      }

      const tiendanubeUrl = `https://api.tiendanube.com/v1/${store_id}/orders/${checkout_id}?fields=id,number,token,contact_name,contact_phone,shipping_store_branch_name,token,shipping_pickup_type,shipping_store_branch_extra,shipping_carrier_name,completed_at,total,products,payment_status,shipping_status`;
      let orderData = null;
      try {
        const resp = await fetch(tiendanubeUrl, {
          method: 'GET',
          headers: {
            'Authentication': `bearer ${accessToken}`,
            'User-Agent': 'Alerti: (contacto@alerti.app)'
          }
        });
        if (!resp.ok) {
          console.warn(`Tiendanube respondió ${resp.status} para ${checkout_id}`);
          continue;
        }
        orderData = await resp.json();
        console.log('[tiendanube response]', { checkout_id, store_id, completed_at_raw: orderData.completed_at, raw: orderData });
      } catch (err) {
        console.error('Error en fetch a Tiendanube:', err);
        continue;
      }

      let completedDateRaw = null;
      if (orderData && orderData.completed_at) {
        if (typeof orderData.completed_at === 'string') {
          completedDateRaw = orderData.completed_at;
        } else if (typeof orderData.completed_at === 'object' && orderData.completed_at.date) {
          completedDateRaw = orderData.completed_at.date;
        }
      }
      const sentinel = '-0001-11-30 00:00:00.000000';
      const converted = typeof completedDateRaw === 'string' && completedDateRaw.trim() !== sentinel;
      if (converted) {
        await client.query("UPDATE checkouts SET status='converted', processed_at=$1 WHERE checkout_id=$2", [now, checkout_id]);
        console.log(`Checkout ${checkout_id} convertido, marcado.`);
        continue;
      }

      const contactPhone = orderData.contact_phone ?? orderData.raw?.contact_phone;
      if (!contactPhone || String(contactPhone).trim() === '') {
        await client.query("UPDATE checkouts SET status='no_contact', processed_at=$1 WHERE checkout_id=$2", [now, checkout_id]);
        console.log(`Checkout ${checkout_id} tiene contact_phone vacío, no se dispara recuperación.`);
        continue;
      }

      try {
        const bubbleUrl = 'https://dashboard.alerti.app/version-test/api/1.1/wf/render_checkout';
        const payload = { store_id, order_id: checkout_id, cart_url };
        console.log('Disparando workflow a Bubble en test', { url: bubbleUrl, payload });

        const bubbleResp = await fetch(bubbleUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!bubbleResp.ok) {
          console.warn(`Bubble devolvió ${bubbleResp.status} para ${checkout_id}`);
          const text = await bubbleResp.text();
          console.warn('Respuesta de Bubble:', text);
          continue;
        }
        await bubbleResp.json();
        await client.query("UPDATE checkouts SET status='abandoned', processed_at=$1 WHERE checkout_id=$2", [now, checkout_id]);
        console.log(`Recuperación disparada para ${checkout_id}`);
      } catch (err) {
        console.error('Error posteando a Bubble:', err);
      }
    }
    return res.json({ ok: true, processed: pendingRes.rows.length });
  } catch (e) {
    console.error('run-pending error', e);
    return res.status(500).json({ error: 'internal' });
  }
}