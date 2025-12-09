use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
  time::{Duration, Instant},
};

use qdrant_client::Qdrant;
use rmcp::{RoleClient, model::ClientInfo, service::RunningService};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::RwLock;

pub(crate) type BatchId = String;
pub(crate) type RegistrationTime = Instant;

pub(crate) type DynamicMcpClient = Arc<RunningService<RoleClient, ClientInfo>>;

pub(crate) struct ServerStatus {
  pub(crate) client: DynamicMcpClient,
  pub(crate) active_batches: HashMap<BatchId, RegistrationTime>,
  pub(crate) latency_history: Vec<Duration>,
}

pub(crate) type ServerMap = HashMap<String, ServerStatus>;

pub(crate) struct AppData {
  pub(crate) servers: ServerMap,
  pub(crate) batch_map: HashMap<BatchId, HashSet<String>>,
  pub(crate) qdrant: Arc<Qdrant>,
  pub(crate) pool: PgPool,
}

pub(crate) type AppState = Arc<RwLock<AppData>>;

#[derive(Deserialize)]
pub(crate) struct RegisterRequest {
  pub(crate) mcp_urls: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct RegisterResponse {
  pub(crate) message: String,
  pub(crate) registered_id: Option<String>,
  pub(crate) urls: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct UnregisterRequest {
  pub(crate) registration_id: String,
}

#[derive(Serialize)]
pub(crate) struct UnregisterResponse {
  pub(crate) message: String,
  pub(crate) urls_affected: usize,
  pub(crate) status: String,
}

#[derive(Deserialize)]
pub(crate) struct BatchMetricsRequest {
  pub(crate) mcp_urls: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct MetricResult {
  pub(crate) url: String,
  pub(crate) average_latency_ms: Option<f64>,
  pub(crate) sample_count: Option<usize>,
  pub(crate) error: Option<String>,
}
