import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppSupabaseAuth } from "@/lib/supabase-auth";

const scanSchema = z.object({
  brand_name: z.string().trim().min(1).max(120),
  competitor_names: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
});

export const getAIVisibilityScansFn = createServerFn({ method: "GET" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAIVisibilityScans } = await import("./ai-visibility.server");
    return getAIVisibilityScans(context.supabase, context.userId);
  });

export const runAIVisibilityScanFn = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((input: unknown) => scanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { runAIVisibilityScan } = await import("./ai-visibility.server");
    return runAIVisibilityScan(
      context.supabase,
      context.userId,
      data.brand_name,
      data.competitor_names,
    );
  });
