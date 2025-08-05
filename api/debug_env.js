// @ts-nocheck
export default function handler(req, res) {
  if (req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({
    DATABASE_URL: process.env.DATABASE_URL,
    DEBUG_SECRET: process.env.DEBUG_SECRET
  });
}