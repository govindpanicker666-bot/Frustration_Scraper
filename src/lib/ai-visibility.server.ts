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
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 12);
}

function buildPrompts(brandName: string, competitors: string[]): string[] {
  const categoryHint = competitors.length
    ? `The competitive alternatives include ${competitors.join(", ")}.`
    : "Consider the leading products in this market.";
  const templates = [
    `What are the best alternatives to ${brandName} for someone evaluating this category?`,
    `What is the best tool for solving the problem that ${brandName} addresses?`,
    `Which ${brandName} competitors should a buyer compare before choosing a solution?`,
    `I am shortlisting software in the same category as ${brandName}. What would you recommend and why?`,
    `What are the most reliable ${brandName} alternatives for a business buyer?`,
    `Compare the leading solutions in the category that ${brandName} operates in.`,
    `Which product offers the best value for money among tools like ${brandName}?`,
    `What should a small business look for when choosing a ${brandName}-type solution?`,
    `Which providers are best for an enterprise that needs the capabilities offered by ${brandName}?`,
    `What are the main strengths and weaknesses of the leading ${brandName}-type products?`,
  ];
  return templates.map((prompt) => `${prompt}\n\n${categoryHint} Give an impartial buyer-focused answer.`);
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
            return [{
              title: chunk.web?.title?.trim() || parsed.hostname,
              url,
              domain: parsed.hostname.replace(/^www\./, ""),
            }];
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

  const competitors = cleanBrandList(competitorNames).filter(
    (name) => name.toLowerCase() !== normalizedBrand.toLowerCase(),
  );
  const prompts = buildPrompts(normalizedBrand, competitors);

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
    modelName: MODEL_NAME,
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
