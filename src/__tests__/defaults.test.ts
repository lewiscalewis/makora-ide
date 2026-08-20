import { describe, it, expect } from "vitest";
import { computeCostUsd, computeWorstCasePromptCost } from "../defaults";

describe("Cost Estimator Math (defaults.ts)", () => {
  it("calculates worst-case prompt cost assuming 0% cache hit and max output tokens", () => {
    // Gemini 3.7 Flash: input $0.075 / M, output $0.30 / M
    const worstCase = computeWorstCasePromptCost(100_000, 4096, undefined, "gemini-3.7-flash", "gemini");
    // (100_000 * 0.075 + 4096 * 0.30) / 1_000_000 = (7.5 + 1.2288) / 1000 = 0.0087288 -> ceil to 6 decimals: 0.008729
    expect(worstCase).toBeGreaterThan(0.0087);
    expect(worstCase).toBeLessThan(0.009);
  });

  it("calculates turn cost with prompt caching discounts", () => {
    // DeepSeek V3: in $0.27 / M, out $1.10 / M, cache discount 90% (only 10% rate)
    const cost = computeCostUsd(
      { inputTokens: 100_000, cachedTokens: 90_000, outputTokens: 2_000 },
      undefined,
      "deepseek-chat",
      "deepseek"
    );
    // Non-cached = 10_000 * 0.27 / 1M = 0.0027
    // Cached = 90_000 * 0.27 * 0.10 / 1M = 0.00243
    // Output = 2_000 * 1.10 / 1M = 0.0022
    // Total = 0.00733
    expect(cost).toBeCloseTo(0.00733, 4);
  });

  it("returns 0 for local models (ollama)", () => {
    const cost = computeCostUsd(
      { inputTokens: 50_000, cachedTokens: 0, outputTokens: 5_000 },
      undefined,
      "deepseek-r1:8b",
      "ollama"
    );
    expect(cost).toBe(0);
  });
});
