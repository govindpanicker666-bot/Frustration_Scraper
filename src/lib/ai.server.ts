// All AI calls go directly to Google Gemini using the project's own keys
// (billed to the user's Google account, not Lovable credits).
// GEMINI_API_KEY is primary; GEMINI_API_KEY_2 is used when the first hits its limit.
export const GEMINI_MODEL = "gemini-4-hydrogen" as const;
export const FALLBACK_MODELS = ["gemini-3.1-flash-lite"] as const;
const MODELS = [GEMINI_MODEL, ...FALLBACK_MODELS];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isUsableKey = (k: string | undefined): k is string =>
  !!k && k.trim().length > 0 && k.trim() !== "MY_GEMINI_API_KEY";

async function callOnce(key: string, model: string, body: unknown) {
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
      },
    );
  } catch (err) {
    return new Response(String(err), { status: 503, statusText: "Fetch failed" });
  }
}

async function callGemini(system: string, user: string): Promise<string> {
  const keys = [process.env["GEMINI_API_KEY"], process.env["GEMINI_API_KEY_2"]].filter(isUsableKey);
  if (!keys.length) throw new Error("GEMINI_API_KEY is not set");
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system + "\nRespond ONLY with valid JSON, no prose." }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
  body["generationConfig"] = { responseMimeType: "application/json" };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of keys) {
      for (const model of MODELS) {
        const res = await callOnce(key, model, body);
        if (res.ok) {
          const json = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        }
        const errBody = await res.text();
        lastErr = `Gemini error ${res.status} (${model}): ${errBody.slice(0, 300)}`;
        if (res.status === 401 || res.status === 403 || errBody.includes("API_KEY_INVALID")) break; // Invalid/forbidden key -> next key
        continue; // 404, 400, 429 (busy/quota), 503 (overloaded), 5xx -> fallback to next model
      }
    }
    await sleep(2000);
  }
  throw new Error(lastErr);
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  return JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T;
}

export async function geminiJson<T>(system: string, user: string): Promise<T> {
  return parseJson<T>(await callGemini(system, user));
}

/** Raw JSON text (caller parses). */
export const callGeminiText = callGemini;
