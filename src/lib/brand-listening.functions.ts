import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function extractEmailFromClaims(claims: unknown): string | null {
  if (!claims || typeof claims !== "object") return null;
  const email = (claims as Record<string, unknown>)["email"];
  return typeof email === "string" && email.trim() ? email.trim() : null;
}

export const getBrandListeningData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readBrandListeningState } = await import("./brand-listening.server");
    return readBrandListeningState(
      context.supabase,
      context.userId,
      extractEmailFromClaims(context.claims),
    );
  });

export const scanOwnBrandMentions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { startBrandListeningScan } = await import("./brand-listening.server");
    return startBrandListeningScan(
      context.supabase,
      context.userId,
      extractEmailFromClaims(context.claims),
    );
  });

export const getBrandHealthRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ force: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { generateBrandHealthRecommendations } = await import("./brand-listening.server");
    return generateBrandHealthRecommendations(context.supabase, context.userId, data.force);
  });

export const generateAiBrandBaselineFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ force: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { generateAIBrandBaselineForUser } = await import("./brand-listening.server");
    return generateAIBrandBaselineForUser(context.supabase, context.userId, {
      force: data.force,
      emailHint: extractEmailFromClaims(context.claims),
    });
  });
