import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';
import pkg from 'pg';
const { Client } = pkg;

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Postgres client (Supabase) ---
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Supabase lo requiere
});

async function ensureConnected() {
  if (!client._connected) {
    await client.connect();
    client._connected = true;
  }
}

async function initDb() {
  await ensureConnected();
  await client.query(`
    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY,
      access_token TEXT,
      created_at BIGINT
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS checkouts (
      checkout_id TEXT PRIMARY KEY,
      store_id TEXT REFERENCES stores(store_id),
      cart_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at BIGINT,
      check_after BIGINT,
      processed_at BIGINT
    );
  `);
}

// --- Helpers ---
function normalizeId(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (s.endsWith('.0')) {
    try {
      s = String(parseInt(parseFloat(s)));
    } catch {}
  }
  return s;
}

async function getAccessToken(store_id_raw) {
  await ensureConnected();
  const store_id = normalizeId(store_id_raw);
  let res = await client.query(
    `SELECT access_token FROM stores WHERE store_id = $1`,
    [store_id]
  );
  if (res.rows.length) return res.rows[0].access_token;
  if (!store_id.endsWith('.0')) {
    res = await client.query(
      `SELECT access_token FROM stores WHERE store_id = $1`,
      [store_id + '.0']
    );
    if (res.rows.length) return res.rows[0].access_token;
  }
  return null;
}

// --- Routes ---

app.post('/register_store', async (req, res) => {
  const raw_store_id = req.body.store_id;
  const access_token = req.body.access_token;
  const store_id = normalizeId(raw_store_id);
  if (!store_id || !access_token) return res.status(400).json({ error: 'Faltan store_id o access_token' });

  const now = Date.now();
  try {
    await ensureConnected();
    await client.query(
      `INSERT INTO stores (store_id, access_token, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (store_id) DO UPDATE SET access_token = EXCLUDED.access_token, created_at = EXCLUDED.created_at`,
      [store_id, access_token, now]
    );
    return res.json({ ok: true, message: 'Tienda registrada' });
  } catch (e) {
    console.error('Error registrando tienda:', e);
    return res.status(500).json({ error: 'no se pudo registrar' });
  }
});

app.post('/checkout', async (req, res) => {
  let { store_id, cart_url } = req.body;
  let order_id = req.body.order_id || req.body.checkout_id;
  store_id = normalizeId(store_id);
  order_id = normalizeId(order_id);
  if (!store_id || !order_id || !cart_url) return res.status(400).json({ error: 'Faltan store_id, order_id o cart_url' });

  const now = Date.now();
  const checkAfter = now + 60 * 60 * 1000; // 60 minutos

  try {
    await ensureConnected();
    await client.query(
      `INSERT INTO checkouts (checkout_id, store_id, cart_url, created_at, check_after)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (checkout_id) DO NOTHING`,
      [order_id, store_id, cart_url, now, checkAfter]
    );
    return res.json({ ok: true, scheduled_for: new Date(checkAfter).toISOString() });
  } catch (e) {
    console.error('Error guardando checkout:', e);
    return res.status(500).json({ error: 'falló guardar' });
  }
});

const DEBUG_SECRET = process.env.DEBUG_SECRET || 'debug123';

app.get('/debug/stores', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });
  await ensureConnected();
  const result = await client.query(`
    SELECT store_id, substring(access_token from 1 for 10) || '...' AS token_preview, created_at
    FROM stores
  `);
  const formatted = result.rows.map((r) => ({
    store_id: r.store_id,
    access_token_preview: r.token_preview,
    created_at: new Date(Number(r.created_at)).toISOString()
  }));
  res.json({ stores: formatted });
});

app.get('/debug/checkouts', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });

  const storeFilter = req.query.store_id ? normalizeId(req.query.store_id) : null;
  const statusFilter = req.query.status ? req.query.status : null;

  let base = `SELECT checkout_id, store_id, cart_url, status, created_at, check_after, processed_at FROM checkouts`;
  const conditions = [];
  const params = [];
  if (storeFilter) {
    conditions.push(`store_id = $${params.length + 1}`);
    params.push(storeFilter);
  }
  if (statusFilter) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(statusFilter);
  }
  if (conditions.length) base += ' WHERE ' + conditions.join(' AND ');
  base += ' ORDER BY created_at DESC LIMIT 100';

  await ensureConnected();
  const result = await client.query(base, params);
  const formatted = result.rows.map((r) => ({
    checkout_id: r.checkout_id,
    store_id: r.store_id,
    cart_url: r.cart_url,
    status: r.status,
    created_at: new Date(Number(r.created_at)).toISOString(),
    check_after: new Date(Number(r.check_after)).toISOString(),
    processed_at: r.processed_at ? new Date(Number(r.processed_at)).toISOString() : null
  }));
  res.json({ checkouts: formatted });
});

// Endpoint manual para procesar pendientes (lo vas a llamar con cron)
app.post('/run-pending', async (req, res) => {
  const secret = req.headers['x-debug-secret'] || req.query.secret;
  if (secret !== DEBUG_SECRET) return res.status(403).json({ error: 'forbidden' });

  const now = Date.now();
  await ensureConnected();
  const pendingRes = await client.query(
    `SELECT * FROM checkouts WHERE status = 'pending' AND check_after <= $1`,
    [now]
  );
  for (const row of pendingRes.rows) {
    const checkout_id = normalizeId(row.checkout_id);
    const store_id = normalizeId(row.store_id);
    const cart_url = row.cart_url;

    console.log(`[worker] procesando ${checkout_id} de store ${store_id}`);

    const accessToken = await getAccessToken(store_id);
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
          Authentication: `bearer ${accessToken}`,
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
      await client.query(`UPDATE checkouts SET status='converted', processed_at=$1 WHERE checkout_id=$2`, [now, checkout_id]);
      console.log(`Checkout ${checkout_id} convertido, marcado.`);
      continue;
    }

    const contactPhone = orderData.contact_phone ?? orderData.raw?.contact_phone;
    if (!contactPhone || String(contactPhone).trim() === '') {
      await client.query(`UPDATE checkouts SET status='no_contact', processed_at=$1 WHERE checkout_id=$2`, [now, checkout_id]);
      console.log(`Checkout ${checkout_id} tiene contact_phone vacío, no se dispara recuperación.`);
      continue;
    }

    // POST a Bubble final
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

      await client.query(`UPDATE checkouts SET status='abandoned', processed_at=$1 WHERE checkout_id=$2`, [now, checkout_id]);
      console.log(`Recuperación disparada para ${checkout_id}`);
    } catch (err) {
      console.error('Error posteando a Bubble:', err);
    }
  }

  return res.json({ ok: true, processed: pendingRes.rows.length });
});

app.get('/health', (req, res) => res.send('ok'));

(async () => {
  try {
    await initDb();
  } catch (e) {
    console.error('Error inicializando DB:', e);
  }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Corriendo en puerto ${PORT}`);
});