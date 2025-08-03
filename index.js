import express from 'express';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(express.json());

// CORS explícito (podés cambiar origin a '*' para pruebas rápidas)
app.use(
  cors({
    origin: ['*'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    preflightContinue: false,
    optionsSuccessStatus: 204
  })
);
app.options('*', cors()); // responder preflight para todo

// --- DB ---
const db = new Database('checkouts.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS checkouts (
    checkout_id TEXT PRIMARY KEY,
    store_id TEXT,
    cart_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER,
    check_after INTEGER,
    processed_at INTEGER
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    store_id TEXT PRIMARY KEY,
    access_token TEXT,
    created_at INTEGER
  );
`);

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

function getAccessToken(store_id_raw) {
  const store_id = normalizeId(store_id_raw);
  let row = db.prepare(`SELECT access_token FROM stores WHERE store_id = ?`).get(store_id);
  if (row) return row.access_token;
  if (!store_id.endsWith('.0')) {
    row = db.prepare(`SELECT access_token FROM stores WHERE store_id = ?`).get(store_id + '.0');
    if (row) return row.access_token;
  }
  return null;
}

// --- Endpoint para registrar tienda ---
app.post('/register_store', (req, res) => {
  const raw_store_id = req.body.store_id;
  const access_token = req.body.access_token;
  const store_id = normalizeId(raw_store_id);

  if (!store_id || !access_token) {
    return res.status(400).json({ error: 'Faltan store_id o access_token' });
  }
  const now = Date.now();
  try {
    db.prepare(`
      INSERT OR REPLACE INTO stores (store_id, access_token, created_at)
      VALUES (?, ?, ?)
    `).run(store_id, access_token, now);
    return res.json({ ok: true, message: 'Tienda registrada' });
  } catch (e) {
    console.error('Error registrando tienda:', e);
    return res.status(500).json({ error: 'no se pudo registrar' });
  }
});

// --- Endpoint que recibe checkout ---
app.post('/checkout', (req, res) => {
  let { store_id, cart_url } = req.body;
  let order_id = req.body.order_id || req.body.checkout_id;
  store_id = normalizeId(store_id);
  order_id = normalizeId(order_id);

  if (!store_id || !order_id || !cart_url) {
    return res.status(400).json({ error: 'Faltan store_id, order_id o cart_url' });
  }

  const now = Date.now();
  const checkAfter = now + 1 * 60 * 1000; // 1 minuto para testing

  try {
    db.prepare(`
      INSERT OR IGNORE INTO checkouts
        (checkout_id, store_id, cart_url, created_at, check_after)
      VALUES (?, ?, ?, ?, ?)
    `).run(order_id, store_id, cart_url, now, checkAfter);
    return res.json({ ok: true, scheduled_for: new Date(checkAfter).toISOString() });
  } catch (e) {
    console.error('Error guardando checkout:', e);
    return res.status(500).json({ error: 'falló guardar' });
  }
});

// --- endpoint de debug para ver tiendas registradas ---
const DEBUG_SECRET = process.env.DEBUG_SECRET || 'debug123';

app.get('/debug/stores', (req, res) => {
  const secret = req.query.secret;
  if (secret !== DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rows = db
    .prepare(`
      SELECT store_id, substr(access_token,1,10) || '...' AS token_preview, created_at
      FROM stores
    `)
    .all();
  const formatted = rows.map((r) => ({
    store_id: r.store_id,
    access_token_preview: r.token_preview,
    created_at: new Date(r.created_at).toISOString()
  }));
  res.json({ stores: formatted });
});

// --- Worker cada minuto ---
async function processPending() {
  const now = Date.now();
  const pending = db
    .prepare(`SELECT * FROM checkouts WHERE status = 'pending' AND check_after <= ?`)
    .all(now);

  for (const row of pending) {
    const checkout_id = normalizeId(row.checkout_id);
    const store_id = normalizeId(row.store_id);
    const cart_url = row.cart_url;

    console.log(`[worker] procesando ${checkout_id} de store ${store_id}`);

    const accessToken = getAccessToken(store_id);
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
      console.log('[tiendanube response]', {
        checkout_id,
        store_id,
        completed_at_raw: orderData.completed_at,
        raw: orderData
      });
    } catch (err) {
      console.error('Error en fetch a Tiendanube:', err);
      continue;
    }

    // Extraer el string real de completed_at
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
      db.prepare(`
        UPDATE checkouts
        SET status='converted', processed_at=?
        WHERE checkout_id=?
      `).run(now, row.checkout_id);
      console.log(`Checkout ${checkout_id} convertido, marcado.`);
      continue;
    }

    // Si no se convirtió: POST a Bubble (nuevo endpoint de prueba)
    try {
      const bubbleUrl = 'https://mailsqueeze.bubbleapps.io/version-test/api/1.1/wf/render_checkout/initialize';
      const payload = {
        store_id,
        order_id: checkout_id,
        cart_url
      };
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

      db.prepare(`
        UPDATE checkouts
        SET status='abandoned', processed_at=?
        WHERE checkout_id=?
      `).run(now, row.checkout_id);

      console.log(`Recuperación disparada para ${checkout_id}`);
    } catch (err) {
      console.error('Error posteando a Bubble:', err);
    }
  }
}

setInterval(() => {
  processPending().catch((e) => console.error('Worker error:', e));
}, 60 * 1000);

app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Corriendo en puerto ${PORT}`);
});