use std::time::Duration;
use std::time::Instant;

use rmcp::model::{ClientRequest, PingRequest};

use crate::{
  HEARTBEAT_INTERVAL_SECONDS, MAX_PING_HISTORY, TIMEOUT_DURATION,
  types::{AppState, DynamicMcpClient},
};

pub(crate) async fn heartbeat_service(state: AppState) {
  let mut interval = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECONDS));

  println!(
    "Heartbeat service started. Pinging every {} seconds. Registration timeout: {}s. Ping history size: {}",
    HEARTBEAT_INTERVAL_SECONDS,
    TIMEOUT_DURATION.as_secs(),
    MAX_PING_HISTORY
  );

  loop {
    interval.tick().await;

    let mut clients_to_ping: Vec<(String, DynamicMcpClient)> = Vec::new();

    let mut app_data = state.write().await;
    let servers = &mut app_data.servers;

    let mut urls_to_remove = Vec::new();

    for (url, status) in servers.iter_mut() {
      let original_reg_count = status.active_batches.len();

      status.active_batches.retain(|id, time| {
        let is_expired = time.elapsed() > TIMEOUT_DURATION;
        if is_expired {
          println!("Batch ID {} for {} timed out after {}s.", id, url, time.elapsed().as_secs());
        }
        !is_expired
      });

      if status.active_batches.is_empty() {
        urls_to_remove.push(url.clone());
      } else if status.active_batches.len() < original_reg_count {
        println!(
          "Server {} still monitored. {} batch ID(s) remaining.",
          url,
          status.active_batches.len()
        );
      }

      if !status.active_batches.is_empty() {
        clients_to_ping.push((url.clone(), status.client.clone()));
      }
    }

    for url in urls_to_remove {
      if servers.remove(&url).is_some() {
        println!("Monitoring stopped for {} (all batch IDs timed out).", url);
      }
    }

    drop(app_data);

    for (url, client) in clients_to_ping {
      let app_state_clone = state.clone();
      tokio::spawn(async move {
        ping_server(app_state_clone, url, client).await;
      });
    }
  }
}

async fn ping_server(state: AppState, url: String, client: DynamicMcpClient) {
  let start_time = Instant::now();

  let result = client.send_request(ClientRequest::PingRequest(PingRequest::default())).await;

  let duration = start_time.elapsed();

  let mut app_data = state.write().await;

  if let Some(status) = app_data.servers.get_mut(&url) {
    match result {
      Ok(_) => {
        println!("Ping SUCCESS for {}: {:#?}", url, duration);
      }
      Err(e) => {
        eprintln!("Ping FAILED for {}: Error: {:?}", url, e);
      }
    }

    status.latency_history.push(duration);
    if status.latency_history.len() > MAX_PING_HISTORY {
      status.latency_history.remove(0);
    }
  } else {
    println!("Ping result received for {}, but server is no longer monitored.", url);
  }
}
