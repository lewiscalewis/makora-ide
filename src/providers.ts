import type { ProviderPreset } from "./types";

export const PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", needsKey: true },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", needsKey: true },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  { id: "ollama", label: "Ollama (local)", kind: "ollama", baseUrl: "http://localhost:11434", needsKey: false },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", needsKey: true },
];

export function presetById(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
