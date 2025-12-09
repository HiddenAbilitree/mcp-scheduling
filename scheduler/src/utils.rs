use crate::types::{MetricResult, ServerStatus};

pub(crate) fn calculate_average_latency(url: String, status: &ServerStatus) -> MetricResult {
  let history_count = status.latency_history.len();
  if history_count == 0 {
    return MetricResult {
      url,
      average_latency_ms: Some(0.0),
      sample_count: Some(0),
      error: None,
    };
  }

  let total_nanos = status.latency_history.iter().map(|d| d.as_nanos() as f64).sum::<f64>();

  let average_nanos = total_nanos / (history_count as f64);
  let average_ms = average_nanos / 1_000_000.0;

  MetricResult {
    url,
    average_latency_ms: Some(average_ms),
    sample_count: Some(history_count),
    error: None,
  }
}
