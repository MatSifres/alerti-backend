// lib/helpers.js
export function normalizeId(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (s.endsWith('.0')) {
    try {
      s = String(parseInt(parseFloat(s)));
    } catch {}
  }
  return s;
}