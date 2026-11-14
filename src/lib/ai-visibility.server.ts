import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;
type Sentiment = "positive" | "neutral" | "negative";

export interface AIVisibilityScanInput {
  userId: string;
  brandName: string;
  competitorNames?: string[];
}

export interface AIVisibilityResult {
  prompt_text: string;
  model_name: string;
  visibility_score: number;
  rank_position: number | null;
  sentiment: Sentiment;
  citations: Array<{ title: string; url: string; domain: string }>;
  mentioned: boolean;
  response_text: string;
}

const MODEL_NAME = "gemini-2.5-flash";
const FALLBACK_MODEL_NAME = "gemini-3.1-flash-lite";
const PROMPT_COUNT = 10;

function cleanBrandList(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 20);
}

function fallbackBuyerPrompts(categoryContext: string): string[] {
  const category = categoryContext.trim() || "this software category";
  return [
    `What are the best ${category} tools for a small business?`,
    `Which ${category} platforms are worth comparing for a growing company?`,
    `What features should I look for when choosing a ${category} solution?`,
    `Which ${category} software offers the best value for money?`,
    `What are the most reliable ${category} providers for a business team?`,
    `How do the leading ${category} solutions compare on ease of use and support?`,
    `What are the main limitations to check before buying ${category} software?`,
    `Which ${category} solution is best for a company with a limited budget?`,
    `What should an enterprise consider before choosing a ${category} vendor?`,
    `Which alternatives should a buyer shortlist when evaluating ${category} products?`,
  ];
}

async function generateBuyerPrompts(
  brandName: string,
  competitors: string[],
  categoryContext: string,
): Promise<string[]> {
  const { geminiJson } = await import("./ai.server");
  const prompt = `Generate exactly 10 realistic buyer-intent questions for an AI visibility benchmark.

Brand being tracked: ${brandName}
Market/category context: ${categoryContext || "Infer the category from the brand and competitor list."}
Competitors for context: ${competitors.join(", ") || "No competitor list supplied."}

Requirements:
- Write questions that real buyers would ask before choosing a product.
- Cover awareness, consideration, and decision intent.
- Include best-tool recommendations, comparisons, features, pricing/value, use cases, reliability, and alternatives.
- Keep questions neutral. Do not write questions designed to make ${brandName} appear in the answer.
- Do not include any vendor name in at least 7 of the 10 questions. At most 3 questions may mention the tracked brand or a competitor.
- Do not make up a product category if the context is unclear; use a clear category-level phrasing.
- Return exactly { "prompts": ["question 1", "..."] } with 10 distinct strings and no extra fields.`;

  try {
    const generated = await geminiJson<{ prompts?: string[] }>(
      "You are an independent B2B buyer-research analyst. Generate balanced, realistic purchase-research questions.",
      prompt,
      { timeoutMs: 30_000, thinkingLevel: "LOW" },
    );
    const prompts = Array.isArray(generated.prompts)
      ? [...new Set(generated.prompts.map((item) => item.trim()).filter(Boolean))]
      : [];
    if (prompts.length >= PROMPT_COUNT) return prompts.slice(0, PROMPT_COUNT);
  } catch (error) {
    console.warn("[AIVisibility] Prompt generation fallback:", error);
  }

  return fallbackBuyerPrompts(categoryContext).slice(0, PROMPT_COUNT);
}

function findBrandMention(text: string, brandName: string, competitorNames: string[]) {
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(text);
  if (!match || match.index === undefined) {
    return { mentioned: false, rank: null as number | null, context: "" };
  }

  const brands = [brandName, ...competitorNames]
    .map((name) => ({ name, first: text.toLowerCase().indexOf(name.toLowerCase()) }))
    .filter((item) => item.first >= 0)
    .sort((a, b) => a.first - b.first);
  const distinctOrder: string[] = [];
  for (const item of brands) {
    if (!distinctOrder.some((name) => name.toLowerCase() === item.name.toLowerCase())) {
      distinctOrder.push(item.name);
    }
  }
  const rank = distinctOrder.findIndex((name) => name.toLowerCase() === brandName.toLowerCase());
  const start = Math.max(0, match.index - 280);
  const end = Math.min(text.length, match.index + brandName.length + 280);
  return { mentioned: true, rank: rank >= 0 ? rank + 1 : 1, context: text.slice(start, end) };
}

function normalizeSentiment(value: unknown): Sentiment {
  const normalized = typeof value === "string" ? value.toLowerCase() : "neutral";
  if (normalized === "positive" || normalized === "negative") return normalized;
  return "neutral";
}

async function callGroundedGemini(prompt: string): Promise<{ responseText: string; modelName: string; citations: AIVisibilityResult["citations"] }> {
  const keys = [process.env["GEMINI_API_KEY"], process.env["GEMINI_API_KEY_2"]]
    .filter((key): key is string => Boolean(key?.trim()));
  if (keys.length === 0) throw new Error("GEMINI_API_KEY is not configured on the server.");

  let lastError = "Gemini request failed.";
  // Follow the app's existing convention: rotate configured keys, then fall
  // back to a second model if the primary model is unavailable.
  for (const modelName of [MODEL_NAME, FALLBACK_MODEL_NAME]) {
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent";
    for (const key of keys) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          const body = await response.text();
          lastError = "Gemini API " + response.status + " (" + modelName + "): " + body.slice(0, 240);
          continue;
        }

        const payload = (await response.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            groundingMetadata?: {
              groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
            };
          }>;
        };
        const candidate = payload.candidates?.[0];
        const responseText = candidate?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
        if (!responseText) {
          lastError = "Gemini returned an empty response (" + modelName + ").";
          continue;
        }

        const grounded = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
          const url = chunk.web?.uri;
          if (!url) return [];
          try {
            const parsed = new URL(url);
            const title = chunk.web?.title?.trim() || parsed.hostname;
            const titleHost = title
              .replace("https://", "")
              .replace("http://", "")
              .split("/")[0]
              .split(" ")[0]
              .toLowerCase();
            const isGoogleRedirect =
              parsed.hostname === "vertexaisearch.cloud.google.com" ||
              parsed.hostname.endsWith(".vertexaisearch.cloud.google.com");
            const rawDomain = isGoogleRedirect && titleHost.includes(".")
              ? titleHost
              : parsed.hostname;
            const domain = rawDomain.startsWith("www.") ? rawDomain.slice(4) : rawDomain;
            return [{ title, url, domain }];
          } catch {
            return [];
          }
        });
        const citations = grounded.filter(
          (item, index, all) => all.findIndex((x) => x.url === item.url) === index,
        );
        return { responseText, modelName, citations };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new Error(lastError);
}
async function analyzeMention(prompt: string, responseText: string, brandName: string, competitors: string[]) {
  const mention = findBrandMention(responseText, brandName, competitors);
  if (!mention.mentioned) {
    return { mentioned: false, rank: null as number | null, sentiment: "neutral" as Sentiment };
  }

  // Classify sentiment using the existing Gemini JSON helper; keep the quote bounded.
  const { geminiJson } = await import("./ai.server");
  const result = await geminiJson<{ sentiment?: string }>(
    "You classify the tone toward a specific brand. Return only JSON.",
    `Classify the sentiment toward "${brandName}" in this answer excerpt. Use positive, neutral, or negative. If the language is mixed or unclear, use neutral.\n\nPrompt: ${prompt}\n\nExcerpt: ${mention.context}\n\nReturn { "sentiment": "positive|neutral|negative" }.`,
    { timeoutMs: 25_000, thinkingLevel: "LOW" },
  ).catch(() => ({ sentiment: "neutral" }));
  return {
    mentioned: true,
    rank: mention.rank,
    sentiment: normalizeSentiment(result.sentiment),
  };
}

export async function runAIVisibilityScan(
  supabase: DB,
  userId: string,
  brandName: string,
  competitorNames: string[] = [],
) {
  const normalizedBrand = brandName.trim();
  if (!normalizedBrand) throw new Error("Brand name is required.");

  // Validate ownership/context: the supplied brand must be the user's own brand profile.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("company_name,company_url")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load your brand profile: ${profileError.message}`);
  if (profile?.company_name && profile.company_name.trim().toLowerCase() !== normalizedBrand.toLowerCase()) {
    throw new Error("Brand name must match your saved company name in the Competitors profile.");
  }

  const { data: storedCompetitors, error: competitorsError } = await supabase
    .from("competitors")
    .select("name,category,description")
    .eq("user_id", userId)
    .limit(20);
  if (competitorsError) throw new Error(`Could not load your saved competitors: ${competitorsError.message}`);

  const competitorRows = storedCompetitors ?? [];
  const competitors = cleanBrandList([
    ...competitorNames,
    ...competitorRows.map((item) => item.name),
  ]).filter((name) => name.toLowerCase() !== normalizedBrand.toLowerCase());
  const categoryContext = [
    profile?.company_url ? `Website: ${profile.company_url}` : "",
    ...competitorRows.map((item) => [item.category, item.description].filter(Boolean).join(" — ")),
  ].filter(Boolean).join("\n").slice(0, 2400);
  const prompts = await generateBuyerPrompts(normalizedBrand, competitors, categoryContext);

  const rows: Database["public"]["Tables"]["ai_visibility_scans"]["Insert"][] = [];
  const failures: string[] = [];

  // Keep concurrency low to avoid exhausting user Gemini quotas.
  for (let index = 0; index < prompts.length; index += 2) {
    const batch = prompts.slice(index, index + 2);
    const settled = await Promise.allSettled(
      batch.map(async (prompt) => {
        const execution = await callGroundedGemini(prompt);
        const analysis = await analyzeMention(prompt, execution.responseText, normalizedBrand, competitors);
        const visibilityScore = analysis.mentioned
          ? Math.max(10, Math.round(100 / (analysis.rank ?? 1)))
          : 0;
        return {
          user_id: userId,
          brand_name: normalizedBrand,
          model_name: execution.modelName,
          prompt_text: prompt,
          visibility_score: visibilityScore,
          rank_position: analysis.rank,
          sentiment: analysis.sentiment,
          citations: execution.citations as unknown as Json,
        };
      }),
    );

    for (const item of settled) {
      if (item.status === "fulfilled") rows.push(item.value);
      else failures.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
    }
  }

  if (rows.length === 0) {
    throw new Error(failures[0] ?? "No prompts could be completed.");
  }

  const { data: saved, error: saveError } = await supabase
    .from("ai_visibility_scans")
    .insert(rows)
    .select("*");
  if (saveError) {
    throw new Error(`Could not save AI visibility results. Apply the ai_visibility_scans migration first. ${saveError.message}`);
  }

  const visibilityScore = Math.round(
    rows.reduce((sum, row) => sum + row.visibility_score, 0) / rows.length,
  );

  return {
    brandName: normalizedBrand,
    modelName: rows[0]?.model_name ?? MODEL_NAME,
    promptsRequested: PROMPT_COUNT,
    promptsCompleted: rows.length,
    visibilityScore,
    mentions: rows.filter((row) => row.rank_position !== null).length,
    failures,
    results: saved ?? [],
  };
}

export async function getAIVisibilityScans(supabase: DB, userId: string) {
  const { data, error } = await supabase
    .from("ai_visibility_scans")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function getAIVisibilityDashboard(supabase: DB, userId: string) {
  const [scans, profileResult, competitorResult] = await Promise.all([
    getAIVisibilityScans(supabase, userId),
    supabase.from("profiles").select("company_name").eq("id", userId).maybeSingle(),
    supabase.from("competitors").select("name").eq("user_id", userId).order("name").limit(30),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (competitorResult.error) throw new Error(competitorResult.error.message);

  return {
    scans,
    brandName: profileResult.data?.company_name ?? "",
    competitorNames: (competitorResult.data ?? []).map((row) => row.name),
  };
}
