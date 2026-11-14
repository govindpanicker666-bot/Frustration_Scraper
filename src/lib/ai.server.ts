// All AI calls go directly to Google Gemini using the project's own keys
// (billed to the user's Google account, not Lovable credits).
// GEMINI_API_KEY is primary; GEMINI_API_KEY_2 is used when the first hits its limit.
export const GEMINI_MODEL = "gemini-4-hydrogen" as const;
export const FALLBACK_MODELS = ["gemini-3.1-flash-lite"] as const;
const MODELS = [GEMINI_MODEL, ...FALLBACK_MODELS];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isUsableKey = (k: string | undefined): k is string =>
  !!k && k.trim().length > 0 && k.trim() !== "MY_GEMINI_API_KEY";

export interface GeminiCallOptions {
  timeoutMs?: number;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
}

async function callOnce(key: string, model: string, body: unknown, timeoutMs: number) {
  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "aistudio-build",
          "x-goog-api-key": key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (err) {
    return new Response(String(err), { status: 503, statusText: "Fetch failed" });
  }
}

async function callGeminiWithModel(
  system: string,
  user: string,
  options: GeminiCallOptions = {},
): Promise<{ text: string; model: string }> {
  const keys = [process.env["GEMINI_API_KEY"], process.env["GEMINI_API_KEY_2"]].filter(isUsableKey);
  if (!keys.length) throw new Error("GEMINI_API_KEY is not set");

  const timeoutMs = options.timeoutMs ?? 45_000;

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of keys) {
      for (const model of MODELS) {
        const generationConfig: Record<string, unknown> = {
          responseMimeType: "application/json",
        };
        if (options.thinkingLevel && model === "gemini-4-hydrogen") {
          generationConfig["thinkingConfig"] = { thinkingLevel: options.thinkingLevel };
        }
        const body: Record<string, unknown> = {
          systemInstruction: {
            parts: [{ text: system + "\nRespond ONLY with valid JSON, no prose." }],
          },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig,
        };

        const res = await callOnce(key, model, body, timeoutMs);
        if (res.ok) {
          const json = (await res.json()) as {
            candidates?: {
              finishReason?: string;
              content?: { parts?: { text?: string }[] };
            }[];
            promptFeedback?: { blockReason?: string };
          };
          const text =
            json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (text.trim().length > 0) return { text, model };
          const reason =
            json.candidates?.[0]?.finishReason ??
            json.promptFeedback?.blockReason ??
            "EMPTY_RESPONSE";
          lastErr = `Gemini empty response (${model}): ${reason}`;
          continue;
        }
        const errBody = await res.text();
        lastErr = `Gemini error ${res.status} (${model}): ${errBody.slice(0, 300)}`;
        if (res.status === 401 || res.status === 403 || errBody.includes("API_KEY_INVALID")) break; // Invalid/forbidden key -> next key
        continue; // 404, 400, 429 (busy/quota), 503 (overloaded), 5xx -> fallback to next model
      }
    }
    if (attempt === 0) await sleep(1500);
  }
  throw new Error(lastErr || "Gemini request failed");
}

async function callGemini(
  system: string,
  user: string,
  options: GeminiCallOptions = {},
): Promise<string> {
  const result = await callGeminiWithModel(system, user, options);
  return result.text;
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start < 0 || end < start) {
    throw new Error(`Invalid JSON from Gemini: ${cleaned.slice(0, 120)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export async function geminiJson<T>(
  system: string,
  user: string,
  options?: GeminiCallOptions,
): Promise<T> {
  return parseJson<T>(await callGemini(system, user, options));
}

/** JSON result plus the exact model selected by the existing key/model fallback loop. */
export async function geminiJsonWithModel<T>(
  system: string,
  user: string,
  options?: GeminiCallOptions,
): Promise<{ data: T; model: string }> {
  const result = await callGeminiWithModel(system, user, options);
  return { data: parseJson<T>(result.text), model: result.model };
}

/** Raw JSON text (caller parses). */
export const callGeminiText = callGemini;
