use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

use crate::types::AppState;

#[derive(Deserialize)]
pub(crate) struct LogToolCallRequest {
  pub(crate) tool_name: String,
  pub(crate) mcp_url: String,
  pub(crate) total_time_ms: u64,
  pub(crate) is_error: bool,
}

pub(crate) async fn log_tool_call(State(state): State<AppState>, Json(payload): Json<LogToolCallRequest>) -> impl IntoResponse {
  println!("recieved logging request");
  let app_data = state.read().await;
  let pool = &app_data.pool;

  let result = sqlx::query!(
    r#"
    INSERT INTO tool_call_results (tool_name, mcp_url, total_time_ms, is_error)
    VALUES ($1, $2, $3, $4)
    "#,
    payload.tool_name,
    payload.mcp_url,
    payload.total_time_ms as i64,
    payload.is_error
  )
  .execute(pool)
  .await;

  println!(
    "Logged call to {} from {} (Error: {}): {}ms",
    payload.tool_name, payload.mcp_url, payload.is_error, payload.total_time_ms
  );

  match result {
    Ok(_) => StatusCode::CREATED.into_response(),
    Err(e) => {
      eprintln!("Failed to log tool call: {}", e);
      StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
  }
}
