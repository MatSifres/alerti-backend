import express from 'express';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

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
function getAccessToken(store_id) {
  const row = db.prepare(`SELECT access_token FROM stores WHERE store_id = ?`).get(store_id);
  return row ? row.access_token : null;
}

// --- Endpoint para registrar tienda ---
app.post('/register_store', (req, res) => {
  const { store_id, access_token } = req.body;
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
  const { store_id, order_id, cart_url } = req.body;
  if (!store_id || !order_id || !cart_url) {
    return res.status(400).json({ error: 'Faltan store_id, order_id o cart_url' });
  }

  const now = Date.now();
  const checkAfter = now + 60 * 60 * 1000; // 60 minutos

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
const DEBUG_SECRET = process.env.DEBUG_SECRET || 'debug123'; // en Render poné una variable más segura

app.get('/debug/stores', (req, res) => {
  const secret = req.query.secret;
  if (secret !== DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rows = db.prepare(`
    SELECT store_id, substr(access_token,1,10) || '...' AS token_preview, created_at
    FROM stores
  `).all();
  const formatted = rows.map(r => ({
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
    const { checkout_id, store_id, cart_url } = row;
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
          'Authentication': `bearer ${accessToken}`,
          'User-Agent': 'Alerti: (contacto@alerti.app)'
        }
      });
      if (!resp.ok) {
        console.warn(`Tiendanube respondió ${resp.status} para ${checkout_id}`);
        continue;
      }
      orderData = await resp.json();
    } catch (err) {
      console.error('Error en fetch a Tiendanube:', err);
      continue;
    }

    const completedAt = orderData.completed_at;
    const converted = completedAt && completedAt !== '-0001-11-30 00:00:00.000000';

    if (converted) {
      db.prepare(`
        UPDATE checkouts
        SET status='converted', processed_at=?
        WHERE checkout_id=?
      `).run(now, checkout_id);
      console.log(`Checkout ${checkout_id} convertido, marcado.`);
      continue;
    }

    // Si no se convirtió: POST a Bubble
    try {
      const bubbleResp = await fetch('https://dashboard.alerti.app/api/1.1/wf/actualizar_checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id,
          order_id: checkout_id,
          cart_url
        })
      });

      if (!bubbleResp.ok) {
        console.warn(`Bubble devolvió ${bubbleResp.status} para ${checkout_id}`);
        continue;
      }
      await bubbleResp.json();

      db.prepare(`
        UPDATE checkouts
        SET status='abandoned', processed_at=?
        WHERE checkout_id=?
      `).run(now, checkout_id);

      console.log(`Recuperación disparada para ${checkout_id}`);
    } catch (err) {
      console.error('Error posteando a Bubble:', err);
    }
  }
}

// loop
setInterval(() => {
  processPending().catch(e => console.error('Worker error:', e));
}, 60 * 1000);

app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Corriendo en puerto ${PORT}`);
});