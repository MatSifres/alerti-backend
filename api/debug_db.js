```js
// api/debug_db.js
// Endpoint para probar conexión directa a la base de datos

// @ts-nocheck
import { getClient } from '../lib/db.js';

export default async function handler(req, res) {
  // Protegemos con el mismo secret
  const secret = req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const client = await getClient();
    // Ejecutamos una consulta sencilla para verificar la conexión
    const result = await client.query('SELECT 1 AS result');
    return res.json({ ok: true, result: result.rows[0].result });
  } catch (e) {
    console.error('Error en debug_db:', e);
    return res.status(500).json({ error: 'db_connection_failed', detail: e.message });
  }
}
```