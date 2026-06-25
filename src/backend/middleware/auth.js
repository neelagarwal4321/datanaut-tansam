import { timingSafeEqual } from "crypto";

const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  console.warn(
    "⚠️  API_SECRET not set — all /api/* endpoints are unprotected.\n" +
    "   Set API_SECRET in src/backend/.env for production use."
  );
}

// Pre-encode secret once so timingSafeEqual comparison is always fixed-length.
const _secretBuf = API_SECRET ? Buffer.from(API_SECRET, "utf8") : null;

/**
 * Checks X-API-Key header (or Authorization: Bearer <key>).
 * Bypassed entirely when API_SECRET env var is not configured (dev mode).
 */
export function requireApiKey(req, res, next) {
  if (!_secretBuf) return next();

  const key =
    req.headers["x-api-key"] ??
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!key) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const keyBuf = Buffer.from(key, "utf8");
  // Lengths must match before timingSafeEqual (different lengths leak info otherwise).
  const valid = keyBuf.length === _secretBuf.length && timingSafeEqual(keyBuf, _secretBuf);
  if (!valid) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}
