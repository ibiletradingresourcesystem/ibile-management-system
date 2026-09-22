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
    /*
     * Google retires model names, and a retired name answers every request with a 404
     * ("no longer available"). Naming a version here means the app breaks the day that
     * version is retired — which is exactly what happened to gemini-2.0-flash.
     * "-latest" is an alias Google keeps pointing at the current model, so it does not rot.
     *
     * Lite is the default because the heavier flash models answer "high demand" (503)
     * often enough on a free key to be felt as a hang; an admin can pick a bigger one.
     */
    defaultModel: "gemini-flash-lite-latest",
    // A starting list only. The real list comes from the key itself (listAvailableModels).
    models: [
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-pro-latest",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ],
    // Tried in turn when the chosen model is gone or the service is busy.
    fallbackModels: ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.6-flash"],
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    fallbackModels: ["gpt-4o-mini"],
    docsUrl: "https://platform.openai.com/api-keys",
  },
};

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

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

function describeError(providerId, error, model) {
  const provider = PROVIDERS[providerId];
  const msg = String(error?.message || error || "").toLowerCase();
  const code = error?.status || error?.response?.status || 0;

  if (code === 401 || code === 403 || msg.includes("api key not valid") || msg.includes("invalid api key") || msg.includes("api_key_invalid") || msg.includes("incorrect api key")) {
    return `${provider.label} rejected the API key. Generate a new one at ${provider.docsUrl} and update ${provider.envKey}.`;
  }
  if (code === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource_exhausted") || msg.includes("insufficient_quota")) {
    return `${provider.label} rate limit or quota reached${model ? ` on ${model}` : ""}. Wait a few minutes, pick a lighter model in AI settings (the Pro models have a much smaller free allowance), or check billing on your ${provider.label} account.`;
  }
  if (code === 404 || msg.includes("model not found") || msg.includes("is not found for api version") || msg.includes("no longer available")) {
    const suggestion = error?.suggestedModel;
    return suggestion
      ? `${provider.label} has retired the model ${model || "in use"}. It now recommends ${suggestion} — pick it in AI settings.`
      : `The ${provider.label} model ${model || "in use"} is not available to this key. Pick a different model in AI settings; the list there comes from your own key.`;
  }
  if (code === 503 || code === 500 || msg.includes("overloaded") || msg.includes("high demand") || msg.includes("unavailable")) {
    return `${provider.label} is busy right now${model ? ` on ${model}` : ""}. Try again in a moment, or pick a Flash Lite model in AI settings.`;
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

/**
 * Gemini over plain HTTP, like the OpenAI call below.
 *
 * The Google SDK reported every failure as a message with no status code, so a retired
 * model, a busy service and a bad key all looked alike and none of them could be
 * recovered from. The REST reply carries the status, and — when a model is retired —
 * the name of the model Google wants used instead.
 */
async function callGemini({ prompt, model, apiKey, json, signal, systemPrompt }) {
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      generationConfig: {
        temperature: 0.4,
        ...(json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    // "…is no longer available. Please update your code to use models/gemini-3.6-flash…"
    err.suggestedModel = message.match(/use\s+models\/([A-Za-z0-9._-]+)/)?.[1] || "";
    throw err;
  }

  const candidate = payload?.candidates?.[0];
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason || (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason))) {
    const err = new Error(`blocked: ${blockReason || candidate.finishReason}`);
    err.status = res.status;
    throw err;
  }

  return (candidate?.content?.parts || []).map((part) => part.text || "").join("");
}

/**
 * The models this key can actually use, asked of the provider itself.
 *
 * A list written into the code goes stale silently: every model the app offered had
 * been retired, so every choice in AI settings led to the same 404.
 */
const MODEL_LIST_TTL_MS = 5 * 60 * 1000;
const modelListCache = new Map(); // providerId -> { at, models }

// Models that answer generateContent but are not general text models (or cost far more).
const NON_CHAT_MODEL = /(tts|image|imagen|veo|lyria|embedding|aqa|robotics|computer-use|deep-research|antigravity|transcribe|nano-banana|omni)/i;

export async function listAvailableModels(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return { models: [], source: "builtin" };

  const cached = modelListCache.get(providerId);
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) return { models: cached.models, source: cached.source };

  const apiKey = String(process.env[provider.envKey] || "").trim();
  const fallback = { models: provider.models, source: "builtin" };
  if (!apiKey || providerId !== "gemini") return fallback;

  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return fallback;
    const payload = await res.json();

    const live = (payload.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((name) => name && !NON_CHAT_MODEL.test(name));

    if (live.length === 0) return fallback;

    // The "-latest" aliases first: they are the ones that keep working.
    const models = [...new Set([...provider.models.filter((m) => live.includes(m)), ...live.sort()])];
    const result = { models, source: "live" };
    modelListCache.set(providerId, { at: Date.now(), ...result });
    return result;
  } catch {
    return fallback;
  }
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

/* ─── Recovering from a model that is gone, or busy ───────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The model name no longer exists for this key. Another model may still work. */
function isRetiredModelError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.status === 404 || msg.includes("no longer available") || msg.includes("is not found for api version");
}

/** The model exists but the service is momentarily overloaded. */
function isBusyError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.status === 503 || error?.status === 500 || msg.includes("overloaded") || msg.includes("high demand");
}

/**
 * Which model to try next, or nothing when the failure is not worth retrying
 * (a bad key, an exhausted quota, a timeout — another model would fail the same way).
 */
function nextModelAfterFailure({ provider, error, model, tried }) {
  const retired = isRetiredModelError(error);
  if (!retired && !isBusyError(error)) return null;

  const timesTried = (name) => tried.filter((name2) => name2 === name).length;

  // A busy model is worth one more go before moving to another one.
  if (!retired && timesTried(model) < 2) return model;

  const candidates = [
    // Google names the replacement in the 404 body; trust that first.
    ...(retired && error?.suggestedModel ? [error.suggestedModel] : []),
    ...(provider.fallbackModels || []),
    provider.defaultModel,
  ];

  return candidates.find((candidate) => candidate && timesTried(candidate) === 0) || null;
}

/** Save a model that worked after the stored one turned out to be retired. */
async function rememberWorkingModel(providerId, from, to) {
  try {
    await mongooseConnect();
    await AISettings.findOneAndUpdate(
      { key: "ai-settings" },
      {
        $set: {
          [providerId === "openai" ? "openaiModel" : "geminiModel"]: to,
          autoSwitchedFrom: from,
          autoSwitchedTo: to,
          autoSwitchedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn("[AI] could not save the replacement model:", err.message);
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
  const chosenModel = options.model || modelFor(settings, providerId);

  let model = chosenModel;
  let lastError = null;
  let retiredModel = false;
  const tried = [];
  const deadline = startTime + REQUEST_TIMEOUT_MS * 2; // the whole thing, retries included

  /*
   * Up to four attempts, because the two failures that actually happen are both
     * recoverable: the chosen model has been retired (404 — Google names its
   * replacement), and the model is momentarily busy (503). Before this, either one
   * meant the whole AI area answered with an error.
   *
   * Each attempt gets its own timeout. One timer over all of them left the last
   * attempt with no time and reported a timeout instead of the real problem.
   */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    tried.push(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const text =
        providerId === "openai"
          ? await callOpenAI({ prompt, model, apiKey, json, signal: controller.signal, systemPrompt })
          : await callGemini({ prompt, model, apiKey, json, signal: controller.signal, systemPrompt });

      const meta = {
        provider: providerId,
        providerLabel: provider.label,
        model,
        promptLength: prompt.length,
        responseLength: text.length,
        executionTimeMs: Date.now() - startTime,
        ...(model !== chosenModel ? { switchedFrom: chosenModel } : {}),
      };

      // The stored choice is gone for good, so save the one that worked. Otherwise
      // every request pays for the failed attempt first.
      if (model !== chosenModel && !options.model && retiredModel) {
        await rememberWorkingModel(providerId, chosenModel, model);
      }

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
      lastError = error;
      const next = nextModelAfterFailure({ provider, error, model, tried });
      if (!next || Date.now() > deadline) break;
      if (isBusyError(error)) await sleep(1200);
      if (isRetiredModelError(error)) retiredModel = true;
      model = next;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    success: false,
    error: describeError(providerId, lastError, tried[tried.length - 1]),
    meta: {
      provider: providerId,
      providerLabel: provider.label,
      model: tried[tried.length - 1],
      triedModels: tried,
      executionTimeMs: Date.now() - startTime,
    },
  };
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
