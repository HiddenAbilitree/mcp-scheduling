mod embeddings;
mod heartbeat;
mod metrics;
mod tool_metrics;
mod tool_registration;
mod tool_retrieval;
mod types;
mod utils;

use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Result;
use axum::{
  Router,
  routing::{get, post},
};
use qdrant_client::Qdrant;
use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::{
  heartbeat::heartbeat_service,
  metrics::post_metrics,
  tool_metrics::log_tool_call,
  tool_registration::{register_server, unregister_server},
  tool_retrieval::search_tools,
  types::{AppData, AppState},
};

const MAX_PING_HISTORY: usize = 100;
const HEARTBEAT_INTERVAL_SECONDS: u64 = 10;
const TIMEOUT_DURATION: Duration = Duration::from_secs(10 * 60);
const QDRANT_URL: &str = dotenvy_macro::dotenv!("QDRANT_URL");
pub const OPENROUTER_API_KEY: &str = dotenvy_macro::dotenv!("OPENROUTER_API_KEY");
pub const DATABASE_URL: &str = dotenvy_macro::dotenv!("DATABASE_URL");
pub const QDRANT_COLLECTION_NAME: &str = "mcp_tools";
// pub const DEFAULT_TOOL_LIMIT: usize = 10;
// pub const DEFAULT_MIN_SIMILARITY: f32 = 0.7;
pub const CLUSTER_SIMILARITY_THRESHOLD: f32 = 0.75;
pub const MAX_TOOL_CALL_LOGS: i64 = 3;
pub const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-3-small";
pub const OPENROUTER_EMBEDDINGS_URL: &str = "https://openrouter.ai/api/v1/embeddings";
pub const N_ERROR_THRESHOLD: i64 = 5;
pub const M_ERROR_WINDOW_MINUTES: i64 = 10;

#[tokio::main]
async fn main() -> Result<()> {
  if cfg!(not(target_arch = "wasm32")) {
    tracing_subscriber::fmt::init();
  }

  let pool = PgPool::connect(DATABASE_URL).await?;

  sqlx::migrate!("./migrations").run(&pool).await?;
  println!("Database migrations completed");

  let qdrant_client = Arc::new(Qdrant::from_url(QDRANT_URL).build().unwrap());

  let state = AppState::new(RwLock::new(AppData {
    servers: HashMap::new(),
    batch_map: HashMap::new(),
    qdrant: qdrant_client,
    pool,
  }));

  let heartbeat_state = state.clone();

  tokio::spawn(async move {
    heartbeat_service(heartbeat_state).await;
  });

  let app = Router::new()
    .route("/", get(root))
    .route("/register", post(register_server))
    .route("/unregister", post(unregister_server))
    .route("/metrics", post(post_metrics))
    .route("/search", get(search_tools))
    .route("/log", post(log_tool_call))
    .with_state(state);

  let listener = tokio::net::TcpListener::bind("0.0.0.0:4000").await.unwrap();
  println!("Axum server listening on 0.0.0.0:4000");
  axum::serve(listener, app).await.unwrap();

  Ok(())
}

async fn root() -> &'static str {
  "MCP Heartbeat Monitor Running"
}
