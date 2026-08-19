import { describe, it, expect } from "vitest";
import { shouldAutoUseMultiAgent } from "../autoRouter";

describe("shouldAutoUseMultiAgent Dynamic Router", () => {
  it("routes short greetings to mono-agent", () => {
    expect(shouldAutoUseMultiAgent("Hola, ¿cómo estás?").useMultiAgent).toBe(false);
    expect(shouldAutoUseMultiAgent("Hello!").useMultiAgent).toBe(false);
    expect(shouldAutoUseMultiAgent("你好").useMultiAgent).toBe(false);
  });

  it("routes architectural refactoring prompts to multi-agent DAG", () => {
    const res1 = shouldAutoUseMultiAgent("Por favor haz un refactor de la arquitectura del store y gateway");
    expect(res1.useMultiAgent).toBe(true);

    const res2 = shouldAutoUseMultiAgent("Realizar una migración completa de módulos y suite de tests");
    expect(res2.useMultiAgent).toBe(true);

    const res3 = shouldAutoUseMultiAgent("Auditar todo el repositorio y generar diagnóstico profundo");
    expect(res3.useMultiAgent).toBe(true);
  });

  it("routes multi-file mentions (>= 3 files) to multi-agent DAG for token isolation", () => {
    const prompt = "Revisa agent.rs, history.rs y gateway.rs para unificar el tratamiento de errores";
    const res = shouldAutoUseMultiAgent(prompt);
    expect(res.useMultiAgent).toBe(true);
    expect(res.reason).toBe("múltiples archivos involucrados");
  });

  it("routes atomic simple single-file queries to direct mono-agent", () => {
    const prompt = "Corrige la variable err en la línea 42 de agent.rs";
    const res = shouldAutoUseMultiAgent(prompt);
    expect(res.useMultiAgent).toBe(false);
  });
});
