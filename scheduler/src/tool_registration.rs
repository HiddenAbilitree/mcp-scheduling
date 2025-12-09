use std::{
  collections::{HashMap, HashSet},
  sync::Arc,
  time::Instant,
};

use anyhow::Result;
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use qdrant_client::qdrant::{CreateCollection, Distance, PointStruct, VectorParams, VectorsConfig};
use rmcp::{
  ServiceExt,
  model::{ClientCapabilities, ClientInfo, Implementation, ProtocolVersion},
  transport::StreamableHttpClientTransport,
};
use uuid::Uuid;

use crate::{
  MAX_PING_HISTORY, QDRANT_COLLECTION_NAME,
  embeddings::generate_embedding,
  types::{AppState, DynamicMcpClient, RegisterRequest, RegisterResponse, ServerStatus, UnregisterRequest, UnregisterResponse},
};

pub(crate) async fn register_server(State(state): State<AppState>, Json(payload): Json<RegisterRequest>) -> impl IntoResponse {
  if payload.mcp_urls.is_empty() {
    return (
      StatusCode::BAD_REQUEST,
      Json(RegisterResponse {
        message: "No URLs provided for registration.".to_string(),
        registered_id: None,
        urls: Vec::new(),
      }),
    )
      .into_response();
  }

  let batch_id = Uuid::new_v4().to_string();
  let registration_time = Instant::now();
  let mut urls_in_batch = HashSet::new();
  let mut successfully_registered_urls = Vec::new();

  let mut app_data = state.write().await;
  let qdrant = app_data.qdrant.clone();
  let servers = &mut app_data.servers;

  println!("Creating new registration {}", batch_id);

  for url in &payload.mcp_urls {
    if let Some(status) = servers.get_mut(url) {
      status.active_batches.insert(batch_id.clone(), registration_time);
      println!("New registration (ID: {}) for existing server: {}", batch_id, url);
    } else {
      println!("Registering new server: {}", url);

      let client_info = ClientInfo {
        protocol_version: ProtocolVersion::default(),
        capabilities: ClientCapabilities::default(),
        client_info: Implementation {
          name: "heartbeat-monitor".to_string(),
          version: "0.1.0".to_string(),
          title: Some("MCP Heartbeat Monitor".to_string()),
          icons: None,
          website_url: None,
        },
      };

      let transport = StreamableHttpClientTransport::from_uri(url.clone());

      let client_result = client_info.serve(transport).await;

      match client_result {
        Ok(client) => {
          let client = Arc::new(client);

          if let Err(e) = fetch_and_store_tools(&client, url, &qdrant).await {
            eprintln!("Failed to fetch/store tools for {}: {}", url, e);
          }

          let mut active_batches = HashMap::new();
          active_batches.insert(batch_id.clone(), registration_time);

          let status = ServerStatus {
            client,
            active_batches,
            latency_history: Vec::with_capacity(MAX_PING_HISTORY),
          };

          servers.insert(url.clone(), status);
        }
        Err(e) => {
          eprintln!("Failed to start client for {}: {:?}", url, e);
          continue;
        }
      }
    }

    urls_in_batch.insert(url.clone());
    successfully_registered_urls.push(url.clone());
  }

  if urls_in_batch.is_empty() {
    return (
      StatusCode::CREATED,
      Json(RegisterResponse {
        message: "All URLs failed to start their MCP client runtime.".to_string(),
        registered_id: None,
        urls: vec![],
      }),
    )
      .into_response();
  }

  app_data.batch_map.insert(batch_id.clone(), urls_in_batch);

  (
    StatusCode::CREATED,
    Json(RegisterResponse {
      message: format!(
        "Successfully registered {} URLs under batch ID {}.",
        successfully_registered_urls.len(),
        batch_id
      ),
      registered_id: Some(batch_id),
      urls: successfully_registered_urls,
    }),
  )
    .into_response()
}

pub(crate) async fn unregister_server(State(state): State<AppState>, Json(payload): Json<UnregisterRequest>) -> impl IntoResponse {
  let batch_id = payload.registration_id;
  let mut app_data = state.write().await;
  let mut urls_stopped_monitoring = 0;

  let urls_in_batch = match app_data.batch_map.remove(&batch_id) {
    Some(urls) => urls,
    None => {
      let response_body = UnregisterResponse {
        message: format!("Batch ID {} not found or already unregistered.", batch_id),
        urls_affected: 0,
        status: "Error: Batch not found".to_string(),
      };
      return (StatusCode::NOT_FOUND, Json(response_body)).into_response();
    }
  };

  let urls_monitored_in_batch = urls_in_batch.len();

  let mut urls_to_remove = Vec::new();

  for url in urls_in_batch {
    if let Some(status) = app_data.servers.get_mut(&url) {
      status.active_batches.remove(&batch_id);

      if status.active_batches.is_empty() {
        urls_to_remove.push(url.clone());
        urls_stopped_monitoring += 1;
      }
    }
  }

  for url in urls_to_remove {
    if app_data.servers.remove(&url).is_some() {
      println!("Monitoring stopped for {} as the last batch ID was unregistered.", url);
    }
  }

  let status_message = if urls_stopped_monitoring > 0 {
    format!("Batch removed. Monitoring stopped for {} URL(s).", urls_stopped_monitoring)
  } else {
    "Batch removed. Monitoring continues for affected URLs.".to_string()
  };

  let response_body = UnregisterResponse {
    message: format!("Batch ID {} removed. It affected {} URLs.", batch_id, urls_monitored_in_batch),
    urls_affected: urls_monitored_in_batch,
    status: status_message,
  };

  (StatusCode::OK, Json(response_body)).into_response()
}

async fn ensure_collection_exists(qdrant: &qdrant_client::Qdrant, vector_size: u64) -> Result<()> {
  let collection_name = QDRANT_COLLECTION_NAME;

  let collections = qdrant.list_collections().await?;
  let collection_exists = collections.collections.iter().any(|c| c.name == collection_name);

  if !collection_exists {
    println!("Creating Qdrant collection: {} with vector size: {}", collection_name, vector_size);
    qdrant
      .create_collection(CreateCollection {
        collection_name: collection_name.to_string(),
        vectors_config: Some(VectorsConfig {
          config: Some(qdrant_client::qdrant::vectors_config::Config::Params(VectorParams {
            size: vector_size,
            distance: Distance::Cosine as i32,
            ..Default::default()
          })),
        }),
        ..Default::default()
      })
      .await?;
    println!("Successfully created collection: {}", collection_name);
  }

  Ok(())
}

async fn fetch_and_store_tools(client: &DynamicMcpClient, mcp_url: &str, qdrant: &std::sync::Arc<qdrant_client::Qdrant>) -> Result<()> {
  let tools_result = client.list_tools(Default::default()).await;
  let tools = match tools_result {
    Ok(tools_response) => tools_response.tools,
    Err(e) => {
      eprintln!("Failed to list tools from {}: {:?}", mcp_url, e);
      return Err(anyhow::anyhow!("Failed to list tools: {:?}", e));
    }
  };

  if tools.is_empty() {
    println!("No tools found for MCP server: {}", mcp_url);
    return Ok(());
  }

  println!("Found {} tools from MCP server: {}", tools.len(), mcp_url);

  let first_tool = &tools[0];
  let first_tool_name = first_tool.name.clone().into_owned();
  let first_tool_description = first_tool.description.clone().map(|d| d.into_owned()).unwrap_or_default();

  let first_description_text = if first_tool_description.is_empty() {
    first_tool_name.clone()
  } else {
    format!("{}: {}", first_tool_name, first_tool_description)
  };

  let first_embedding = generate_embedding(&first_description_text).await?;
  let vector_size = first_embedding.len() as u64;

  ensure_collection_exists(qdrant, vector_size).await?;

  let mut points = Vec::new();

  let point_id_str = format!("{}:{}", mcp_url, first_tool_name);
  let point_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, point_id_str.as_bytes()).to_string();

  let mut payload_map = HashMap::new();
  payload_map.insert(
    "name".to_string(),
    qdrant_client::qdrant::Value {
      kind: Some(qdrant_client::qdrant::value::Kind::StringValue(first_tool_name.clone())),
    },
  );
  payload_map.insert(
    "description".to_string(),
    qdrant_client::qdrant::Value {
      kind: Some(qdrant_client::qdrant::value::Kind::StringValue(first_tool_description.clone())),
    },
  );
  payload_map.insert(
    "mcp_url".to_string(),
    qdrant_client::qdrant::Value {
      kind: Some(qdrant_client::qdrant::value::Kind::StringValue(mcp_url.to_string())),
    },
  );

  let schema_json = serde_json::to_string(&first_tool.input_schema).unwrap_or_else(|_| "{}".to_string());
  payload_map.insert(
    "inputSchema".to_string(),
    qdrant_client::qdrant::Value {
      kind: Some(qdrant_client::qdrant::value::Kind::StringValue(schema_json)),
    },
  );

  let point = PointStruct::new(point_id, first_embedding, payload_map);
  points.push(point);

  for tool in tools.iter().skip(1) {
    let tool_name = tool.name.clone().into_owned();
    let tool_description = tool.description.clone().map(|d| d.into_owned()).unwrap_or_default();

    let description_text = if tool_description.is_empty() {
      tool_name.clone()
    } else {
      format!("{}: {}", tool_name, tool_description)
    };

    let embedding = match generate_embedding(&description_text).await {
      Ok(emb) => emb,
      Err(e) => {
        eprintln!("Failed to generate embedding for tool {}: {}", tool_name, e);
        continue;
      }
    };

    let point_id_str = format!("{}:{}", mcp_url, tool_name);
    let point_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, point_id_str.as_bytes()).to_string();

    let mut payload_map = HashMap::new();
    payload_map.insert(
      "name".to_string(),
      qdrant_client::qdrant::Value {
        kind: Some(qdrant_client::qdrant::value::Kind::StringValue(tool_name.clone())),
      },
    );
    payload_map.insert(
      "description".to_string(),
      qdrant_client::qdrant::Value {
        kind: Some(qdrant_client::qdrant::value::Kind::StringValue(tool_description.clone())),
      },
    );
    payload_map.insert(
      "mcp_url".to_string(),
      qdrant_client::qdrant::Value {
        kind: Some(qdrant_client::qdrant::value::Kind::StringValue(mcp_url.to_string())),
      },
    );

    let schema_json = serde_json::to_string(&tool.input_schema).unwrap_or_else(|_| "{}".to_string());
    payload_map.insert(
      "inputSchema".to_string(),
      qdrant_client::qdrant::Value {
        kind: Some(qdrant_client::qdrant::value::Kind::StringValue(schema_json)),
      },
    );

    let point = PointStruct::new(point_id, embedding, payload_map);

    points.push(point);
  }

  if points.is_empty() {
    println!("No valid points to insert for MCP server: {}", mcp_url);
    return Ok(());
  }

  let points_count = points.len();

  qdrant
    .upsert_points(qdrant_client::qdrant::UpsertPoints {
      collection_name: QDRANT_COLLECTION_NAME.to_string(),
      wait: Some(true),
      points,
      ..Default::default()
    })
    .await?;

  println!("Successfully stored {} tool embeddings for MCP server: {}", points_count, mcp_url);

  Ok(())
}
