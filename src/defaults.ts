import type { AppConfig, ModelConfig, ThinkingLevel } from "./types";

export const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "none", label: "Ninguno (rápido)" },
  { value: "minimal", label: "Mínimo" },
  { value: "low", label: "Bajo" },
  { value: "medium", label: "Medio" },
  { value: "high", label: "Alto" },
];

export const MODERN_PROVIDER_MODELS: Record<string, ModelConfig[]> = {
  deepseek: [
    {
      id: "deepseek-chat",
      label: "DeepSeek V3 (Chat & Código)",
      providerId: "deepseek",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.27,
      outputPrice: 1.10,
    },
    {
      id: "deepseek-reasoner",
      label: "DeepSeek R1 (Razonamiento Profundo)",
      providerId: "deepseek",
      thinkingLevel: "high",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: false,
      inputPrice: 0.55,
      outputPrice: 2.19,
    },
  ],
  gemini: [
    {
      id: "gemini-3.7-flash",
      label: "Google Gemini 3.7 Flash (Recomendado)",
      providerId: "gemini",
      thinkingLevel: "medium",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 0.075,
      outputPrice: 0.30,
    },
    {
      id: "gemini-3.6-flash",
      label: "Google Gemini 3.6 Flash (Rápido)",
      providerId: "gemini",
      thinkingLevel: "medium",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 0.075,
      outputPrice: 0.30,
    },
    {
      id: "gemini-3.1-pro-preview",
      label: "Google Gemini 3.1 Pro (Flagship Razonamiento)",
      providerId: "gemini",
      thinkingLevel: "high",
      contextWindow: 2000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 1.25,
      outputPrice: 5.00,
    },
    {
      id: "gemini-2.5-flash",
      label: "Google Gemini 2.5 Flash",
      providerId: "gemini",
      thinkingLevel: "medium",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 0.075,
      outputPrice: 0.30,
    },
    {
      id: "gemini-2.5-pro",
      label: "Google Gemini 2.5 Pro",
      providerId: "gemini",
      thinkingLevel: "high",
      contextWindow: 2000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 1.25,
      outputPrice: 5.00,
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      label: "OpenAI GPT-4o (Omnimodal)",
      providerId: "openai",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 16384,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 2.50,
      outputPrice: 10.00,
    },
    {
      id: "gpt-4o-mini",
      label: "OpenAI GPT-4o Mini (Rápido y Económico)",
      providerId: "openai",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 16384,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 0.15,
      outputPrice: 0.60,
    },
    {
      id: "o3-mini",
      label: "OpenAI o3-mini (Razonamiento STEM)",
      providerId: "openai",
      thinkingLevel: "high",
      contextWindow: 200000,
      maxOutputTokens: 65536,
      reasoningEnabled: true,
      visionEnabled: false,
      inputPrice: 1.10,
      outputPrice: 4.40,
    },
    {
      id: "o1",
      label: "OpenAI o1 (Razonamiento y Visión Completo)",
      providerId: "openai",
      thinkingLevel: "high",
      contextWindow: 200000,
      maxOutputTokens: 65536,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 15.00,
      outputPrice: 60.00,
    },
  ],
  anthropic: [
    {
      id: "claude-3-7-sonnet-latest",
      label: "Claude 3.7 Sonnet (Pensamiento Extendido)",
      providerId: "anthropic",
      thinkingLevel: "high",
      contextWindow: 200000,
      maxOutputTokens: 16384,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 3.00,
      outputPrice: 15.00,
    },
    {
      id: "claude-3-5-sonnet-latest",
      label: "Claude 3.5 Sonnet (Especialista Código)",
      providerId: "anthropic",
      thinkingLevel: "low",
      contextWindow: 200000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 3.00,
      outputPrice: 15.00,
    },
    {
      id: "claude-3-5-haiku-latest",
      label: "Claude 3.5 Haiku (Rápido y Ligero)",
      providerId: "anthropic",
      thinkingLevel: "low",
      contextWindow: 200000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 0.80,
      outputPrice: 4.00,
    },
  ],
  groq: [
    {
      id: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B (Groq Ultra-Rápido)",
      providerId: "groq",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.59,
      outputPrice: 0.79,
    },
    {
      id: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B (Groq Instantáneo)",
      providerId: "groq",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.05,
      outputPrice: 0.08,
    },
    {
      id: "qwen-qwq-32b",
      label: "QwQ 32B (Groq Razonamiento)",
      providerId: "groq",
      thinkingLevel: "high",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: false,
      inputPrice: 0.29,
      outputPrice: 0.39,
    },
    {
      id: "llama-3.2-11b-vision-preview",
      label: "Llama 3.2 11B Vision (Groq Visión)",
      providerId: "groq",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 0.18,
      outputPrice: 0.18,
    },
  ],
  openrouter: [
    {
      id: "deepseek/deepseek-r1",
      label: "DeepSeek R1 (vía OpenRouter)",
      providerId: "openrouter",
      thinkingLevel: "high",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: false,
      inputPrice: 0.55,
      outputPrice: 2.19,
    },
    {
      id: "anthropic/claude-3.7-sonnet",
      label: "Claude 3.7 Sonnet (vía OpenRouter)",
      providerId: "openrouter",
      thinkingLevel: "high",
      contextWindow: 200000,
      maxOutputTokens: 16384,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 3.00,
      outputPrice: 15.00,
    },
    {
      id: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash (vía OpenRouter)",
      providerId: "openrouter",
      thinkingLevel: "medium",
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      reasoningEnabled: true,
      visionEnabled: true,
      inputPrice: 0.075,
      outputPrice: 0.30,
    },
    {
      id: "openai/gpt-4o",
      label: "OpenAI GPT-4o (vía OpenRouter)",
      providerId: "openrouter",
      thinkingLevel: "low",
      contextWindow: 128000,
      maxOutputTokens: 16384,
      reasoningEnabled: false,
      visionEnabled: true,
      inputPrice: 2.50,
      outputPrice: 10.00,
    },
  ],
  ollama: [
    {
      id: "deepseek-r1:8b",
      label: "DeepSeek R1 8B (Ollama Local)",
      providerId: "ollama",
      thinkingLevel: "high",
      contextWindow: 64000,
      maxOutputTokens: 4096,
      reasoningEnabled: true,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
    {
      id: "qwen2.5-coder:7b",
      label: "Qwen 2.5 Coder 7B (Ollama Local)",
      providerId: "ollama",
      thinkingLevel: "low",
      contextWindow: 32000,
      maxOutputTokens: 4096,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
    {
      id: "llama3.2:3b",
      label: "Llama 3.2 3B (Ollama Local)",
      providerId: "ollama",
      thinkingLevel: "low",
      contextWindow: 32000,
      maxOutputTokens: 4096,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
  ],
  lmstudio: [
    {
      id: "local-model",
      label: "LM Studio Modelo Activo",
      providerId: "lmstudio",
      thinkingLevel: "low",
      contextWindow: 32000,
      maxOutputTokens: 4096,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
  ],
  makoraai: [
    {
      id: "makoraai:latest",
      label: "MakoraAI 30B MoE (Local Agéntico)",
      providerId: "makoraai",
      thinkingLevel: "none",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
    {
      id: "qwen3-coder:30b",
      label: "Qwen3 Coder 30B (Ollama Base)",
      providerId: "makoraai",
      thinkingLevel: "none",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
    {
      id: "makoraai-30b",
      label: "MakoraAI 30B MoE (Sidecar Embebido)",
      providerId: "makoraai",
      thinkingLevel: "none",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
    {
      id: "makoraai-8b",
      label: "MakoraAI 8B (Sidecar Embebido)",
      providerId: "makoraai",
      thinkingLevel: "none",
      contextWindow: 32768,
      maxOutputTokens: 8192,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
  ],
  custom: [
    {
      id: "default",
      label: "Modelo Personalizado",
      providerId: "custom",
      thinkingLevel: "low",
      contextWindow: 64000,
      maxOutputTokens: 4096,
      reasoningEnabled: false,
      visionEnabled: false,
      inputPrice: 0.00,
      outputPrice: 0.00,
    },
  ],
};

export function getRecommendedModelsForProvider(providerId: string): ModelConfig[] {
  const norm = providerId.trim().toLowerCase();
  return MODERN_PROVIDER_MODELS[norm] || MODERN_PROVIDER_MODELS.deepseek;
}

export function isModelReasoningSupported(id: string, modelConfig?: ModelConfig): boolean {
  if (modelConfig && typeof modelConfig.reasoningEnabled === "boolean") {
    return modelConfig.reasoningEnabled;
  }
  const lower = id.toLowerCase();
  return (
    lower.includes("reason") ||
    lower.includes("r1") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("thinking") ||
    lower.includes("claude-3-7") ||
    lower.includes("qwq") ||
    lower.includes("gemini-2.5") ||
    lower.includes("gemini-3.")
  );
}

export function isModelVisionSupported(id: string, modelConfig?: ModelConfig): boolean {
  if (modelConfig && typeof modelConfig.visionEnabled === "boolean") {
    return modelConfig.visionEnabled;
  }
  const lower = id.toLowerCase();
  if (lower.includes("deepseek") && !lower.includes("vl")) return false;
  if (lower.includes("o3-mini") || lower.includes("o1-mini")) return false;
  if (lower.includes("qwen-qwq")) return false;
  return (
    lower.includes("gemini") ||
    lower.includes("claude") ||
    lower.includes("gpt-4o") ||
    lower.includes("o1") ||
    lower.includes("vision") ||
    lower.includes("vl") ||
    lower.includes("pixtral")
  );
}

export function inferModelConfig(id: string, providerId: string = "deepseek"): ModelConfig {
  const lower = id.toLowerCase();
  
  // Check predefined modern models first
  const match = Object.values(MODERN_PROVIDER_MODELS)
    .flat()
    .find((m) => m.id.toLowerCase() === lower || m.id.toLowerCase() === lower.replace(/^models\//, ""));
  if (match) {
    return { ...match, providerId };
  }

  const visionEnabled = isModelVisionSupported(id);
  const reasoningEnabled = isModelReasoningSupported(id);
  
  let contextWindow = 128000;
  if (lower.includes("gemini")) contextWindow = lower.includes("pro") ? 2000000 : 1000000;
  else if (lower.includes("claude")) contextWindow = 200000;
  else if (lower.includes("o1") || lower.includes("o3")) contextWindow = 200000;

  let inputPrice = 0.27;
  let outputPrice = 1.10;

  if (lower.includes("gemini")) {
    if (lower.includes("pro")) {
      inputPrice = 1.25;
      outputPrice = 5.00;
    } else {
      inputPrice = 0.075;
      outputPrice = 0.30;
    }
  } else if (lower.includes("deepseek")) {
    if (lower.includes("reasoner") || lower.includes("r1")) {
      inputPrice = 0.55;
      outputPrice = 2.19;
    } else {
      inputPrice = 0.27;
      outputPrice = 1.10;
    }
  } else if (lower.includes("claude")) {
    if (lower.includes("haiku")) {
      inputPrice = 0.80;
      outputPrice = 4.00;
    } else {
      inputPrice = 3.00;
      outputPrice = 15.00;
    }
  } else if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) {
    if (lower.includes("4o-mini") || lower.includes("mini")) {
      inputPrice = 0.15;
      outputPrice = 0.60;
    } else if (lower.includes("o1") || lower.includes("o3")) {
      inputPrice = 1.10;
      outputPrice = 4.40;
    } else {
      inputPrice = 2.50;
      outputPrice = 10.00;
    }
  }

  return {
    id,
    label: id,
    providerId,
    thinkingLevel: reasoningEnabled ? "high" : "none",
    contextWindow,
    maxOutputTokens: 8192,
    reasoningEnabled,
    visionEnabled,
    inputPrice,
    outputPrice,
  };
}

export function computeWorstCasePromptCost(
  inputTokens: number,
  maxOutputTokens: number = 4096,
  modelConfig?: ModelConfig,
  modelId?: string,
  providerId?: string
): number {
  let inPrice = modelConfig?.inputPrice ?? 0;
  let outPrice = modelConfig?.outputPrice ?? 0;

  if (inPrice <= 0 || outPrice <= 0) {
    const inferred = inferModelConfig(modelId || modelConfig?.id || "default", providerId || modelConfig?.providerId || "deepseek");
    inPrice = inPrice > 0 ? inPrice : inferred.inputPrice;
    outPrice = outPrice > 0 ? outPrice : inferred.outputPrice;
  }

  // Pre-flight worst case: 0% cache hit, full input rate + max output tokens at output rate
  const rawCost = (Math.max(0, inputTokens) * inPrice + Math.max(0, maxOutputTokens) * outPrice) / 1_000_000;
  return Number.isFinite(rawCost) && rawCost >= 0 ? Math.ceil(rawCost * 1_000_000) / 1_000_000 : 0;
}

export function computeCostUsd(
  usage: { inputTokens: number; outputTokens: number; cachedTokens?: number },
  modelConfig?: ModelConfig,
  modelId?: string,
  providerId?: string
): number {
  let inPrice = modelConfig?.inputPrice ?? 0;
  let outPrice = modelConfig?.outputPrice ?? 0;

  if (inPrice <= 0 || outPrice <= 0) {
    const inferred = inferModelConfig(modelId || modelConfig?.id || "default", providerId || modelConfig?.providerId || "deepseek");
    inPrice = inPrice > 0 ? inPrice : inferred.inputPrice;
    outPrice = outPrice > 0 ? outPrice : inferred.outputPrice;
  }

  const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens);
  const nonCachedInput = Math.max(0, usage.inputTokens - cached);

  const lowerId = (modelId || modelConfig?.id || "").toLowerCase();
  const lowerProv = (providerId || modelConfig?.providerId || "").toLowerCase();
  
  // Prompt caching discount:
  // DeepSeek & Anthropic: 90% discount on cached tokens (only 10% price)
  // Gemini: 75% discount on cached tokens
  // OpenAI / others: 50% discount
  let cacheMultiplier = 0.10;
  if (lowerProv.includes("gemini") || lowerId.includes("gemini")) {
    cacheMultiplier = 0.25;
  } else if (lowerProv.includes("openai") || lowerId.includes("gpt") || lowerId.includes("o3") || lowerId.includes("o1")) {
    cacheMultiplier = 0.50;
  } else if (lowerProv.includes("groq") || lowerProv.includes("ollama")) {
    cacheMultiplier = 1.0;
  }

  const cost =
    (nonCachedInput * inPrice +
      cached * inPrice * cacheMultiplier +
      usage.outputTokens * outPrice) /
    1_000_000;

  // Redondeo al alza matemáticamente conservador (límite superior a 6 decimales)
  return Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1_000_000) / 1_000_000 : 0;
}

export const DEFAULT_CONFIG: AppConfig = {
  models: Object.values(MODERN_PROVIDER_MODELS).flat(),
  skills: [],
  mcps: [
    {
      name: "github",
      command: "npx",
      args: "-y @modelcontextprotocol/server-github",
      enabled: false,
    },
  ],
  context: {
    maxTokens: 64000,
    systemShare: 5,
    historyShare: 30,
    filesShare: 45,
    repoMapTokens: 2000,
    compactionThreshold: 0.6,
    includeWorkspace: true,
  },
};
