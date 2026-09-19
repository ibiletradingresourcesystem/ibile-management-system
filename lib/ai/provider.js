/**
 * AI provider abstraction.
 *
 * Every AI feature used to call Google Gemini directly with the key read
 * inline, so when that key stopped being accepted the whole AI area simply
 * returned "I'm unable to process your question right now" with no way to tell
 * why or to switch to something else.
 *
 * Now there is one entry point, `generateAIText`, which routes to whichever
 * provider the business has selected and whose key is actually present. It
 * returns the provider's real error message so the UI can say what is wrong.
 *
 * Keys live in environment variables only:
 *   GEMINI_API_KEY   Google AI Studio key
 *   OPENAI_API_KEY   OpenAI API key
 */
import { mongooseConnect } from "@/lib/mongodb";
import AISettings from "@/models/AISettings";

export const PROVIDERS = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"],
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    docsUrl: "https://platform.openai.com/api-keys",
  },
};

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 45000;

/** Which providers have a key set in the environment. */
export function availableProviders() {
  return Object.values(PROVIDERS).reduce((acc, provider) => {
    const key = process.env[provider.envKey];
    acc[provider.id] = Boolean(key && String(key).trim());
    return acc;
  }, {});
}

/** Load (and create on first use) the singleton settings document. */
export async function getAISettings() {
  await mongooseConnect();
  let settings = await AISettings.findOne({ key: "ai-settings" }).lean();
  if (!settings) {
    const created = await AISettings.create({ key: "ai-settings" });
    settings = created.toObject();
  }
  return settings;
}

/**
 * Decide which provider a request should use.
 * An explicit choice wins as long as its key exists; otherwise fall back to any
 * provider that does have a key, so one missing key never takes the app down.
 */
export function resolveProvider(settings, requested) {
  const available = availableProviders();
  const preference = requested || settings?.provider || "auto";

  if (preference !== "auto" && available[preference]) return preference;

  // Explicit choice with no key, or "auto": take the first configured provider.
  const fallback = Object.keys(PROVIDERS).find((id) => available[id]);

  return fallback || null;
}

function modelFor(settings, providerId) {
  if (providerId === "openai") return settings?.openaiModel || PROVIDERS.openai.defaultModel;
  return settings?.geminiModel || PROVIDERS.gemini.defaultModel;
}

/* ─── Error messages people can act on ────────────────────────────── */

function describeError(providerId, error, status) {
  const provider = PROVIDERS[providerId];
  const msg = String(error?.message || error || "").toLowerCase();
  const code = status || error?.status || error?.response?.status || 0;

  if (code === 401 || code === 403 || msg.includes("api key not valid") || msg.includes("invalid api key") || msg.includes("api_key_invalid") || msg.includes("incorrect api key")) {
    return `${provider.label} rejected the API key. Generate a new one at ${provider.docsUrl} and update ${provider.envKey}.`;
  }
  if (code === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource_exhausted") || msg.includes("insufficient_quota")) {
    return `${provider.label} rate limit or quota reached. Wait a few minutes, or check billing on your ${provider.label} account.`;
  }
  if (code === 404 || msg.includes("model not found") || msg.includes("is not found for api version")) {
    return `The selected ${provider.label} model is not available to this key. Pick a different model in AI settings.`;
  }
  if (msg.includes("safety") || msg.includes("blocked") || msg.includes("recitation") || msg.includes("content_filter")) {
    return `${provider.label} filtered this response. Try rephrasing the question.`;
  }
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("deadline")) {
    return `${provider.label} did not respond in time. Check the connection and try again.`;
  }
  if (msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("enotfound") || msg.includes("network")) {
    return `Could not reach ${provider.label}. Check the server's internet connection.`;
  }
  return `${provider.label} error: ${error?.message || "Unknown error"}`;
}

/* ─── Provider calls ──────────────────────────────────────────────── */

async function callGemini({ prompt, model, apiKey, json, signal }) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const client = new GoogleGenerativeAI(apiKey);
  const generativeModel = client.getGenerativeModel({
    model,
    ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
  });
  const result = await generativeModel.generateContent(prompt, { signal });
  return result.response.text();
}

async function callOpenAI({ prompt, model, apiKey, json, signal, systemPrompt }) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.4,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return payload?.choices?.[0]?.message?.content || "";
}

/** Pull JSON out of a reply that may be wrapped in a markdown code fence. */
export function parseJsonResponse(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Some models add prose around the object — take the outermost braces.
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    const firstArr = candidate.indexOf("[");
    const lastArr = candidate.lastIndexOf("]");
    const useArray = firstArr >= 0 && (first < 0 || firstArr < first);
    const start = useArray ? firstArr : first;
    const end = useArray ? lastArr : last;
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Generate text from the active provider.
 *
 * @param {string} prompt
 * @param {Object} [options]
 * @param {boolean} [options.json]     ask the model for JSON and parse it
 * @param {string}  [options.provider] force a provider for this call
 * @param {string}  [options.systemPrompt] OpenAI system message
 * @returns {Promise<{success:boolean,text?:string,data?:any,error?:string,meta:Object}>}
 */
export async function generateAIText(prompt, options = {}) {
  const startTime = Date.now();
  const { json = false, provider: requested, systemPrompt } = options;

  let settings = null;
  try {
    settings = await getAISettings();
  } catch {
    settings = null; // a database hiccup must not hide the AI entirely
  }

  if (settings && settings.enabled === false) {
    return {
      success: false,
      error: "AI features are switched off in AI settings.",
      meta: { executionTimeMs: Date.now() - startTime, disabled: true },
    };
  }

  const providerId = resolveProvider(settings, requested);
  if (!providerId) {
    return {
      success: false,
      error:
        "No AI provider is configured. Add GEMINI_API_KEY or OPENAI_API_KEY to the server environment, then pick a provider in AI settings.",
      meta: { executionTimeMs: Date.now() - startTime, unconfigured: true },
    };
  }

  const provider = PROVIDERS[providerId];
  const apiKey = String(process.env[provider.envKey] || "").trim();
  const model = options.model || modelFor(settings, providerId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const text =
      providerId === "openai"
        ? await callOpenAI({ prompt, model, apiKey, json, signal: controller.signal, systemPrompt })
        : await callGemini({ prompt, model, apiKey, json, signal: controller.signal });

    const meta = {
      provider: providerId,
      providerLabel: provider.label,
      model,
      promptLength: prompt.length,
      responseLength: text.length,
      executionTimeMs: Date.now() - startTime,
    };

    if (json) {
      const data = parseJsonResponse(text);
      if (!data) {
        return {
          success: false,
          text,
          error: `${provider.label} returned a response that was not valid JSON. Try again.`,
          meta,
        };
      }
      return { success: true, text, data, meta };
    }

    return { success: true, text, meta };
  } catch (error) {
    return {
      success: false,
      error: describeError(providerId, error),
      meta: {
        provider: providerId,
        providerLabel: provider.label,
        model,
        executionTimeMs: Date.now() - startTime,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A cheap live call used by the settings screen to prove a key works. */
export async function testProvider(providerId) {
  const result = await generateAIText("Reply with the single word: OK", { provider: providerId });
  return {
    provider: providerId,
    ok: result.success,
    error: result.error || "",
    model: result.meta?.model || "",
    executionTimeMs: result.meta?.executionTimeMs || 0,
    sample: result.success ? String(result.text || "").trim().slice(0, 40) : "",
  };
}

export default generateAIText;
