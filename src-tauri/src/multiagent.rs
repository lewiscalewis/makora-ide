//! Makora Multi-Agent Orchestrator & Task Graph Engine
//!
//! Provides hierarchical orchestrator-worker delegation with ephemeral context isolation.
//! Subagents (Explorer, Coder, Tester, Reviewer) execute specialized workloads,
//! discarding intermediate tool output noise and returning distilled synthesis briefings.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use specta::Type;

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

    pub fn default_allowed_tools(&self) -> Vec<&'static str> {
        match self {
            SubagentRole::Explorer => vec!["list_dir", "grep_search", "view_file", "locate_files"],
            SubagentRole::Coder => vec!["replace_file_content", "multi_replace_file_content", "write_to_file", "view_file"],
            SubagentRole::Tester => vec!["bash", "execute_command", "view_file"],
            SubagentRole::Reviewer => vec!["view_file", "grep_search"],
        }
    }

    pub fn system_prompt(&self) -> &'static str {
        match self {
            SubagentRole::Explorer => {
                "Eres el Subagente Explorador de Makora. Tu objetivo es buscar, indexar y extraer el contexto mínimo relevante para el Coder. Descarta código irrelevante y genera un Briefing Técnico conciso (<1500 tokens)."
            }
            SubagentRole::Coder => {
                "Eres el Subagente Programador de Makora. Tu objetivo es aplicar parches precisos, quirúrgicos y con sintaxis válida, siguiendo estrictamente el briefing técnico proporcionado."
            }
            SubagentRole::Tester => {
                "Eres el Subagente Tester de Makora. Tu objetivo es ejecutar suites de pruebas, linters o compilaciones en segundo plano y extraer exclusivamente los diagnósticos de fallo relevantes si los hay."
            }
            SubagentRole::Reviewer => {
                "Eres el Subagente Revisor de Makora. Tu objetivo es auditar que las modificaciones respeten la arquitectura, las directrices y las reglas de oro del repositorio."
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
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
}
