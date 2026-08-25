import type { ProviderPreset } from "./types";

export const PROVIDERS: ProviderPreset[] = [
  { id: "deepseek", label: "DeepSeek (Recomendado)", kind: "openai", baseUrl: "https://api.deepseek.com/v1", needsKey: true },
  { id: "gemini", label: "Google Gemini (Google AI Studio)", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  { id: "openrouter", label: "OpenRouter (Multi-Proveedor)", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "openai", label: "OpenAI (GPT-4o / o1 / o3-mini)", kind: "openai", baseUrl: "https://api.openai.com/v1", needsKey: true },
  { id: "anthropic", label: "Anthropic (Claude 3.5 Sonnet)", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  { id: "makoraai", label: "MakoraAI (Local · Qwen3-Coder-30B)", kind: "ollama", baseUrl: "http://localhost:11434/v1", needsKey: false },
  { id: "ollama", label: "Ollama (LLM Local)", kind: "ollama", baseUrl: "http://localhost:11434/v1", needsKey: false },
  { id: "lmstudio", label: "LM Studio (LLM Local)", kind: "openai", baseUrl: "http://localhost:1234/v1", needsKey: false },
  { id: "groq", label: "Groq (Ultra-Fast Inference)", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "custom", label: "Servidor Personalizado (OpenAI Compatible)", kind: "openai", baseUrl: "", needsKey: true },
];

export function presetById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
