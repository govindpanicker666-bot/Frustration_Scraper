import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const metaName =
        typeof meta["full_name"] === "string"
          ? meta["full_name"].trim()
          : typeof meta["name"] === "string"
            ? meta["name"].trim()
            : "";
      const profileName =
        profile && typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      const fullName = profileName || metaName || null;
      return { user, profile, fullName, isAdmin: !!roles?.some((r) => r.role === "admin") };
    },
  });
}
