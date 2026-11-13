import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UploadInput = {
  fileName: string;
  contentType: string;
  dataBase64: string;
};

function safeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);
}

export const uploadBlogMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: UploadInput) => d)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const bin = atob(data.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.byteLength > 10_000_000) throw new Error("File too large (max 10MB)");
    const path = `${new Date().getFullYear()}/${Date.now()}-${safeName(data.fileName || "file")}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from("blog-media").upload(path, bytes, {
      contentType: data.contentType || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { url: `/api/public/blog-media/${path}` };
  });
