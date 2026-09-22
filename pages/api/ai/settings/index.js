/**
 * API: /api/ai/settings
 *
 * GET    — which providers have keys, which one is active, model choices and
 *          the result of the last connectivity check.
 * PUT    — change the active provider / model (admin only).
 * POST   — run a live test call against a provider and report the real error.
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import AISettings from "@/models/AISettings";
import {
  PROVIDERS,
  availableProviders,
  getAISettings,
  listAvailableModels,
  resolveProvider,
  testProvider,
} from "@/lib/ai/provider";

async function publicShape(settings) {
  const available = availableProviders();

  // The models each key can really use. A list written into the code goes stale:
  // every Gemini model this app offered had been retired by Google.
  const modelLists = Object.fromEntries(
    await Promise.all(
      Object.values(PROVIDERS).map(async (p) => [p.id, available[p.id] ? await listAvailableModels(p.id) : { models: p.models, source: "builtin" }])
    )
  );

  return {
    provider: settings?.provider || "auto",
    activeProvider: resolveProvider(settings),
    enabled: settings?.enabled !== false,
    geminiModel: settings?.geminiModel || PROVIDERS.gemini.defaultModel,
    openaiModel: settings?.openaiModel || PROVIDERS.openai.defaultModel,
    available,
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      envKey: p.envKey,
      models: modelLists[p.id].models,
      modelsSource: modelLists[p.id].source,
      recommendedModel: p.defaultModel,
      docsUrl: p.docsUrl,
      configured: available[p.id],
    })),
    autoSwitch: settings?.autoSwitchedAt
      ? { from: settings.autoSwitchedFrom, to: settings.autoSwitchedTo, at: settings.autoSwitchedAt }
      : null,
    lastCheck: settings?.lastCheckedAt
      ? {
          at: settings.lastCheckedAt,
          provider: settings.lastCheckProvider,
          ok: settings.lastCheckOk,
          error: settings.lastCheckError,
        }
      : null,
  };
}

/** "" when the model can be used, otherwise why not. */
async function checkModel(providerId, model) {
  const name = String(model || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/.test(name)) return "That model name does not look right";

  const { models, source } = await listAvailableModels(providerId);
  if (models.includes(name)) return "";
  if (source === "builtin") return ""; // could not ask the provider — take the admin's word for it
  return `${PROVIDERS[providerId].label} does not offer "${name}" to this key`;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    const settings = await getAISettings();
    return res.status(200).json({ success: true, settings: await publicShape(settings) });
  }

  if (req.method === "PUT") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    const { provider, geminiModel, openaiModel, enabled } = req.body || {};
    const update = {};

    if (provider !== undefined) {
      if (!["auto", "gemini", "openai"].includes(provider)) {
        return res.status(400).json({ error: "Unknown provider" });
      }
      update.provider = provider;
    }
    // Checked against the models the key itself offers, not a list in the code —
    // that list was stale, and it would have refused every model that still works.
    if (geminiModel !== undefined) {
      const error = await checkModel("gemini", geminiModel);
      if (error) return res.status(400).json({ error });
      update.geminiModel = geminiModel;
      update.autoSwitchedAt = null;
      update.autoSwitchedFrom = "";
      update.autoSwitchedTo = "";
    }
    if (openaiModel !== undefined) {
      const error = await checkModel("openai", openaiModel);
      if (error) return res.status(400).json({ error });
      update.openaiModel = openaiModel;
      update.autoSwitchedAt = null;
      update.autoSwitchedFrom = "";
      update.autoSwitchedTo = "";
    }
    if (enabled !== undefined) update.enabled = Boolean(enabled);

    const settings = await AISettings.findOneAndUpdate(
      { key: "ai-settings" },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    return res.status(200).json({ success: true, settings: await publicShape(settings) });
  }

  if (req.method === "POST") {
    const requested = req.body?.provider;
    const settings = await getAISettings();
    const target = requested && requested !== "auto" ? requested : resolveProvider(settings);

    if (!target) {
      return res.status(200).json({
        success: false,
        result: {
          provider: null,
          ok: false,
          error:
            "No AI provider is configured. Add GEMINI_API_KEY or OPENAI_API_KEY to the server environment and restart.",
        },
      });
    }

    const result = await testProvider(target);

    await AISettings.findOneAndUpdate(
      { key: "ai-settings" },
      {
        $set: {
          lastCheckedAt: new Date(),
          lastCheckProvider: target,
          lastCheckOk: result.ok,
          lastCheckError: result.error || "",
        },
      },
      { upsert: true }
    );

    const refreshed = await getAISettings();
    return res.status(200).json({ success: result.ok, result, settings: await publicShape(refreshed) });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
