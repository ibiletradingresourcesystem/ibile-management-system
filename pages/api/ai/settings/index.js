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
import { PROVIDERS, availableProviders, getAISettings, resolveProvider, testProvider } from "@/lib/ai/provider";

function publicShape(settings) {
  const available = availableProviders();
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
      models: p.models,
      docsUrl: p.docsUrl,
      configured: available[p.id],
    })),
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

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    const settings = await getAISettings();
    return res.status(200).json({ success: true, settings: publicShape(settings) });
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
    if (geminiModel !== undefined) {
      if (!PROVIDERS.gemini.models.includes(geminiModel)) {
        return res.status(400).json({ error: "Unknown Gemini model" });
      }
      update.geminiModel = geminiModel;
    }
    if (openaiModel !== undefined) {
      if (!PROVIDERS.openai.models.includes(openaiModel)) {
        return res.status(400).json({ error: "Unknown OpenAI model" });
      }
      update.openaiModel = openaiModel;
    }
    if (enabled !== undefined) update.enabled = Boolean(enabled);

    const settings = await AISettings.findOneAndUpdate(
      { key: "ai-settings" },
      { $set: update },
      { new: true, upsert: true }
    ).lean();

    return res.status(200).json({ success: true, settings: publicShape(settings) });
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
    return res.status(200).json({ success: result.ok, result, settings: publicShape(refreshed) });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
