// api/health.js

// Este console.log se ejecuta en import, es decir, al levantar/vercel-dev
console.log('⚙️ [health] ENV cargado:', {
  SUPABASE_URL:              process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:  process.env.SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL:              process.env.DATABASE_URL,
  DEBUG_SECRET:              process.env.DEBUG_SECRET
});

export default function handler(req, res) {
  // Responde siempre OK
  res.status(200).json({ ok: true });
}