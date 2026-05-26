import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

/**
 * Every authenticated session is an admin (single role).
 * Use requireAdmin() on every admin-only API route.
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }
  return { ok: true as const, session };
}
