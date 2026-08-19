//! Makora Multi-Agent Orchestrator & Task Graph Engine
//!
//! Provides hierarchical orchestrator-worker delegation with ephemeral context isolation.
//! Subagents (Explorer, Coder, Tester, Reviewer) execute specialized workloads,
//! discarding intermediate tool output noise and returning distilled synthesis briefings.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SubagentRole {
    Explorer,
    Coder,
    Tester,
    Reviewer,
}

impl SubagentRole {
    pub fn name(&self) -> &'static str {
        match self {
            SubagentRole::Explorer => "Explorer (Context Condenser)",
            SubagentRole::Coder => "Coder (Patch Specialist)",
            SubagentRole::Tester => "Tester (Test & Linter Runner)",
            SubagentRole::Reviewer => "Reviewer (Quality & Architecture Guard)",
        }
    }

    #[allow(dead_code)]
    pub fn default_allowed_tools(&self) -> Vec<&'static str> {
        match self {
            SubagentRole::Explorer => vec!["list_dir", "grep", "read_file_range", "read_file"],
            SubagentRole::Coder => vec!["apply_patch", "write_file", "read_file_range", "read_file"],
            SubagentRole::Tester => vec!["bash", "read_file_range"],
            SubagentRole::Reviewer => vec!["read_file_range", "grep", "list_dir"],
        }
    }

    pub fn system_prompt(&self) -> &'static str {
        match self {
            SubagentRole::Explorer => {
                "Eres el Subagente Explorador de Makora. Tu único objetivo es inspeccionar el workspace, mapear símbolos y extraer el contexto mínimo relevante. NUNCA edites archivos. Descarta ruido de dependencias y genera un Briefing Técnico conciso (<1200 tokens) con rutas y números de línea exactos."
            }
            SubagentRole::Coder => {
                "Eres el Subagente Programador de Makora. Tu único objetivo es aplicar cambios quirúrgicos y precisos usando EXCLUSIVAMENTE apply_patch con 3-5 líneas de anclaje exactas. No reescribas archivos enteros. Respeta estrictamente los contratos de tipos y las invariantes del briefing."
            }
            SubagentRole::Tester => {
                "Eres el Subagente Tester de Makora. Tu objetivo es ejecutar suites de pruebas (cargo test, npm test, etc.) o comandos de verificación silenciosos con bash, extrayendo exclusivamente el diagnóstico relevante si hay fallos o confirmando el éxito."
            }
            SubagentRole::Reviewer => {
                "Eres el Subagente Revisor de Makora. Tu objetivo es auditar que las modificaciones respeten la arquitectura, la higiene, la seguridad y la ausencia de regresiones. Emite un dictamen conciso de aprobación o corrección."
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SubagentTaskRequest {
    pub task_id: String,
    pub session_id: String,
    pub role: SubagentRole,
    pub instruction: String,
    pub context_briefing: String,
    pub target_files: Vec<String>,
    pub max_steps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SubagentTaskResult {
    pub task_id: String,
    pub role: SubagentRole,
    pub success: bool,
    pub summary: String,
    pub modified_files: Vec<String>,
    pub diagnostics: Option<String>,
    pub tokens_used: u32,
    pub cost_usd: f64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentPlanStep {
    pub step_index: u32,
    pub title: String,
    pub role: SubagentRole,
    pub status: String, // 'pending' | 'running' | 'completed' | 'failed'
    pub result_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentPlanState {
    pub plan_id: String,
    pub session_id: String,
    pub objective: String,
    pub steps: Vec<MultiAgentPlanStep>,
    pub active_step_index: Option<u32>,
    pub is_completed: bool,
    pub total_tokens: u32,
    pub total_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentPlanEvent {
    pub chat_id: String,
    pub plan: MultiAgentPlanState,
}

/// Generates a standard multi-agent execution DAG for complex heavy tasks
pub fn create_default_plan(session_id: &str, objective: &str) -> MultiAgentPlanState {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let plan_id = format!("plan_{now}");

    let steps = vec![
        MultiAgentPlanStep {
            step_index: 0,
            title: "Exploración e Indexación de Contexto".into(),
            role: SubagentRole::Explorer,
            status: "pending".into(),
            result_summary: None,
        },
        MultiAgentPlanStep {
            step_index: 1,
            title: "Implementación Quirúrgica de Código".into(),
            role: SubagentRole::Coder,
            status: "pending".into(),
            result_summary: None,
        },
        MultiAgentPlanStep {
            step_index: 2,
            title: "Validación y Ejecución de Pruebas".into(),
            role: SubagentRole::Tester,
            status: "pending".into(),
            result_summary: None,
        },
        MultiAgentPlanStep {
            step_index: 3,
            title: "Revisión Arquitectónica y Cierre".into(),
            role: SubagentRole::Reviewer,
            status: "pending".into(),
            result_summary: None,
        },
    ];

    MultiAgentPlanState {
        plan_id,
        session_id: session_id.to_string(),
        objective: objective.to_string(),
        steps,
        active_step_index: Some(0),
        is_completed: false,
        total_tokens: 0,
        total_cost_usd: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_default_plan() {
        let plan = create_default_plan("sess_123", "Refactorizar arquitectura");
        assert_eq!(plan.session_id, "sess_123");
        assert_eq!(plan.steps.len(), 4);
        assert_eq!(plan.steps[0].role, SubagentRole::Explorer);
        assert_eq!(plan.steps[1].role, SubagentRole::Coder);
        assert_eq!(plan.steps[2].role, SubagentRole::Tester);
        assert_eq!(plan.steps[3].role, SubagentRole::Reviewer);
        assert!(!plan.is_completed);
    }

    #[test]
    fn test_subagent_roles_tools_and_prompts() {
        let roles = [
            SubagentRole::Explorer,
            SubagentRole::Coder,
            SubagentRole::Tester,
            SubagentRole::Reviewer,
        ];
        for role in roles {
            assert!(!role.name().is_empty());
            assert!(!role.system_prompt().is_empty());
            let tools = role.default_allowed_tools();
            assert!(!tools.is_empty());
        }
    }

    #[test]
    fn test_subagent_task_request_and_result_serde() {
        let req = SubagentTaskRequest {
            task_id: "t_1".into(),
            session_id: "s_1".into(),
            role: SubagentRole::Explorer,
            instruction: "Find auth functions".into(),
            context_briefing: "Look in src/".into(),
            target_files: vec!["src/auth.rs".into()],
            max_steps: 5,
        };
        let serialized = serde_json::to_string(&req).expect("serialize req");
        let deserialized: SubagentTaskRequest = serde_json::from_str(&serialized).expect("deserialize req");
        assert_eq!(deserialized.task_id, "t_1");
        assert_eq!(deserialized.role, SubagentRole::Explorer);

        let res = SubagentTaskResult {
            task_id: "t_1".into(),
            role: SubagentRole::Explorer,
            success: true,
            summary: "Found 2 endpoints".into(),
            modified_files: vec![],
            diagnostics: None,
            tokens_used: 420,
            cost_usd: 0.0012,
            duration_ms: 350,
        };
        let res_ser = serde_json::to_string(&res).expect("serialize res");
        let res_de: SubagentTaskResult = serde_json::from_str(&res_ser).expect("deserialize res");
        assert!(res_de.success);
        assert_eq!(res_de.tokens_used, 420);
    }
}

