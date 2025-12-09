use axum::{Json, extract::State};

use crate::{
  types::{AppState, BatchMetricsRequest, MetricResult},
  utils::calculate_average_latency,
};

pub(crate) async fn post_metrics(State(state): State<AppState>, Json(payload): Json<BatchMetricsRequest>) -> Json<Vec<MetricResult>> {
  let app_data = state.read().await;
  let mut results = Vec::new();

  for url in payload.mcp_urls {
    if let Some(status) = app_data.servers.get(&url) {
      let result = calculate_average_latency(url, status);
      results.push(result);
    } else {
      results.push(MetricResult {
        url,
        average_latency_ms: None,
        sample_count: None,
        error: Some("URL not currently monitored.".to_string()),
      });
    }
  }

  Json(results)
}
