import { createMiddleware } from "@tanstack/react-start";
import type { Database } from "@/integrations/supabase/types";

/**
 * Shared server-function auth middleware pinned to the canonical Supabase constants
 * (matching the browser client and /api/admin handlers) so mismatched or placeholder
 * process.env keys never cause "Invalid API key" errors on server RPCs.
 */
export const requireAppSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { createClient } = await import("@supabase/supabase-js");
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("@/integrations/supabase/constants");

    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization") ?? "";
    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }
    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token || token.split(".").length !== 3) {
      throw new Error("Unauthorized: Invalid token");
    }

    const supabaseUrl = SUPABASE_URL.trim().replace(/\/+$/, "");
    const supabaseAnonKey = SUPABASE_ANON_KEY.trim();

    const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let claims: Record<string, unknown> | undefined;
    let userId: string | undefined;

    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (!claimsErr && claimsData?.claims?.sub) {
      claims = claimsData.claims as Record<string, unknown>;
      userId = claimsData.claims.sub;
    } else {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData.user?.id) {
        throw new Error("Unauthorized: Invalid token");
      }
      userId = userData.user.id;
      claims = {
        sub: userData.user.id,
        email: userData.user.email ?? undefined,
      };
    }

    return next({
      context: {
        supabase,
        userId,
        claims,
      },
    });
  },
);
