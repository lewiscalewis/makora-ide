export interface MultiAgentDecision {
  useMultiAgent: boolean;
  reason: string;
}

/**
 * Heurística de decisión inteligente para alternar entre mono-agente directo
 * y DAG multi-agente (Explorer ➔ Coder ➔ Tester ➔ Reviewer).
 *
 * Maximiza la eficiencia de tokens y la calidad de respuesta.
 */
export function shouldAutoUseMultiAgent(
  promptText: string,
  _workspaceFolders: string[] = [],
  _historyCount: number = 0,
): MultiAgentDecision {
  const trimmed = promptText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Saludos, consultas puntuales o atómicas -> mono-agente ultra rápido (<1.5s) sin sobrecoste
  const isGreeting = /^(hola|buenas|hey|hello|hi|gracias|thanks|saludos|danke|merci|ciao|obrigado|你好|嗨)\b/i.test(trimmed);
  if (isGreeting && trimmed.length < 80) {
    return { useMultiAgent: false, reason: "saludo / consulta simple" };
  }

  // 2. Patrones de alta complejidad técnica o arquitectónica -> multi-agente automático
  const complexTriggers = [
    /refactor/i,
    /arquitectura/i,
    /architecture/i,
    /migr(ar|aci[oó]n|ate|ation)/i,
    /m[uú]ltiples\s+(archivos|m[oó]dulos|carpetas)/i,
    /multiple\s+files/i,
    /auditar?\s+(todo|completo|proyecto|repo)/i,
    /audit\s+(all|entire|codebase|repo)/i,
    /crear?\s+(sistema|m[oó]dulo|framework|pipeline)\s+completo/i,
    /build\s+(entire|complete)\s+(system|framework|pipeline)/i,
    /suite\s+(de\s+)?tests?/i,
    /test\s+suite/i,
    /diagn[oó]stico\s+profundo/i,
    /deep\s+diagnostics?/i,
    /analizar?\s+(todos|completo)\s+los\s+(archivos|logs)/i,
    /重构/i,
    /架构/i,
    /测试套件/i,
    /全面审计/i,
  ];

  const hasComplexTrigger = complexTriggers.some((re) => re.test(lower));
  const pathMatches = promptText.match(/[\w/\\-]+\.(rs|ts|tsx|js|jsx|py|json|md|toml|yaml|yml)/g) || [];
  const hasMultipleFiles = pathMatches.length >= 3;

  if (hasComplexTrigger || hasMultipleFiles) {
    return {
      useMultiAgent: true,
      reason: hasComplexTrigger
        ? "complejidad técnica multifichero"
        : "múltiples archivos involucrados",
    };
  }

  return { useMultiAgent: false, reason: "tarea puntual mono-agente" };
}
