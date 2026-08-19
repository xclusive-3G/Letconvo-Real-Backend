import { requireAuth } from "./auth.js";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function checkAdminAllowlist(req, res, next) {
  const email = req.user?.email?.toLowerCase();

  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

// requireAuth first (verifies the Supabase token, sets req.user), then the
// allowlist check — express flattens middleware arrays passed to
// router.get/post/etc, so callers just do router.get(path, requireAdmin, handler).
export const requireAdmin = [requireAuth, checkAdminAllowlist];
