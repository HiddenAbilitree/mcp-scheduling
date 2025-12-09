use axum::{Json, extract::Query, extract::State, http::StatusCode, response::IntoResponse};
use futures::future::join_all;
use qdrant_client::qdrant::{Condition, Filter, RetrievedPoint, ScrollPoints, VectorsOutput};
use serde::{Deserialize, Serialize};

use crate::{
  CLUSTER_SIMILARITY_THRESHOLD, M_ERROR_WINDOW_MINUTES, MAX_TOOL_CALL_LOGS, N_ERROR_THRESHOLD, QDRANT_COLLECTION_NAME, types::AppState,
};

#[derive(Deserialize)]
pub(crate) struct SearchToolsQuery {
  pub(crate) batch_id: String,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct ToolResult {
  pub(crate) name: String,
  pub(crate) mcp_url: String,
}

pub(crate) async fn search_tools(State(state): State<AppState>, Query(params): Query<SearchToolsQuery>) -> impl IntoResponse {
  let app_data = state.read().await;
  let qdrant = &app_data.qdrant;
  let pool = &app_data.pool;

  println!("Searching for tools...");

  let Some(urls) = app_data.batch_map.get(&params.batch_id) else {
    eprintln!("No active registration with id {}", params.batch_id);
    return (StatusCode::NOT_FOUND, Json(Vec::<ToolResult>::new())).into_response();
  };

  let mut points = Vec::new();
  let mut next_page = None;

  loop {
    let scroll_response = qdrant
      .scroll(ScrollPoints {
        collection_name: QDRANT_COLLECTION_NAME.to_string(),
        filter: Some(Filter::must([Condition::matches(
          "mcp_url",
          urls.iter().cloned().collect::<Vec<_>>(),
        )])),
        with_payload: Some(true.into()),
        with_vectors: Some(true.into()),
        limit: Some(100),
        offset: next_page,
        ..Default::default()
      })
      .await;

    match scroll_response {
      Ok(resp) => {
        points.extend(resp.result);
        next_page = resp.next_page_offset;
        if next_page.is_none() {
          break;
        }
      }
      Err(e) => {
        eprintln!("Failed to scroll Qdrant: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(Vec::<ToolResult>::new())).into_response();
      }
    }
  }

  if points.is_empty() {
    return (StatusCode::OK, Json(Vec::<ToolResult>::new())).into_response();
  }

  let all_clustered_tools = cluster_data(points.clone());

  let fastest_tools: Vec<_> = join_all(all_clustered_tools.into_iter().map(|original_tool_category| {
    let pool = pool.clone();
    async move {
      let mut errored_tools_in_category: Vec<(String, String)> = Vec::new();

      for point in &original_tool_category {
        let tool_name = extract_string_from_payload(&point.payload, "name").unwrap_or_default();
        let mcp_url = extract_string_from_payload(&point.payload, "mcp_url").unwrap_or_default();

        let error_count = sqlx::query_scalar!(
          r#"
          SELECT COUNT(*) AS "count!"
          FROM tool_call_results
          WHERE tool_name = $1
            AND mcp_url = $2
            AND is_error = TRUE
            AND timestamp > NOW() - INTERVAL '1 minute' * $3
          "#,
          tool_name,
          mcp_url,
          M_ERROR_WINDOW_MINUTES as i64
        )
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

        if error_count >= N_ERROR_THRESHOLD {
          errored_tools_in_category.push((tool_name, mcp_url));
        }
      }

      let filtered_tool_category: Vec<RetrievedPoint> = original_tool_category
        .clone()
        .into_iter()
        .filter(|point| {
          let tool_name = extract_string_from_payload(&point.payload, "name").unwrap_or_default();
          let mcp_url = extract_string_from_payload(&point.payload, "mcp_url").unwrap_or_default();
          !errored_tools_in_category.contains(&(tool_name, mcp_url))
        })
        .collect();

      let mut candidates = join_all(filtered_tool_category.into_iter().map(|tool| {
        let pool = pool.clone();
        async move {
          let avg_time = sqlx::query_scalar!(
            r#"
            SELECT AVG(total_time_ms)::FLOAT AS "avg_total_time_ms!"
            FROM (
                SELECT total_time_ms
                FROM tool_call_results
                WHERE tool_name = $1 AND mcp_url = $2 AND is_error = FALSE
                ORDER BY timestamp DESC
                LIMIT $3
            ) AS recent_logs
            "#,
            extract_string_from_payload(&tool.payload, "name").unwrap_or_default(),
            extract_string_from_payload(&tool.payload, "mcp_url").unwrap_or_default(),
            MAX_TOOL_CALL_LOGS
          )
          .fetch_one(&pool)
          .await
          .unwrap_or(0.0);

          (tool, avg_time)
        }
      }))
      .await
      .into_iter()
      .min_by(|(_, a), (_, b)| a.total_cmp(b));

      if candidates.is_none() && !original_tool_category.is_empty() {
        candidates = join_all(original_tool_category.into_iter().map(|tool| {
          let pool = pool.clone();
          async move {
            let avg_time = sqlx::query_scalar!(
              r#"
              SELECT AVG(total_time_ms)::FLOAT AS "avg_total_time_ms!"
              FROM (
                  SELECT total_time_ms
                  FROM tool_call_results
                  WHERE tool_name = $1 AND mcp_url = $2 AND is_error = FALSE
                  ORDER BY timestamp DESC
                  LIMIT $3
              ) AS recent_logs
              "#,
              extract_string_from_payload(&tool.payload, "name").unwrap_or_default(),
              extract_string_from_payload(&tool.payload, "mcp_url").unwrap_or_default(),
              MAX_TOOL_CALL_LOGS
            )
            .fetch_one(&pool)
            .await
            .unwrap_or(0.0);

            (tool, avg_time)
          }
        }))
        .await
        .into_iter()
        .min_by(|(_, a), (_, b)| a.total_cmp(b));
      }

      candidates.map(|(tool, _)| tool)
    }
  }))
  .await
  .into_iter()
  .flatten()
  .map(|node| ToolResult {
    mcp_url: extract_string_from_payload(&node.payload, "mcp_url").unwrap_or_default(),
    name: extract_string_from_payload(&node.payload, "name").unwrap_or_default(),
  })
  .collect();

  println!("Found tools: {:#?}", fastest_tools);

  (StatusCode::OK, Json(Some(fastest_tools))).into_response()
}

/// Finds clusters of tools based on the definition embeddings
/// i.e.:
/// tool 1 description: scrape a website
/// tool 2 description: give a website to scrape the contents of
/// Tools 1 and 2 should be a part of a group.
/// tool 3 description: Find the sum of two numbers
///
/// Expected return value: vec![vec![tool1, tool2], vec![tool3]]
fn cluster_data(points: Vec<RetrievedPoint>) -> Vec<Vec<RetrievedPoint>> {
  let mut clusters: Vec<Vec<RetrievedPoint>> = Vec::new();

  for point in points {
    let point_vec_opt = get_vector(&point.vectors);

    if let Some(point_vec) = point_vec_opt {
      let mut assigned = false;
      for cluster in &mut clusters {
        let is_similar = cluster.iter().any(|member| {
          if let Some(member_vec) = get_vector(&member.vectors) {
            cosine_similarity(point_vec, member_vec) >= CLUSTER_SIMILARITY_THRESHOLD
          } else {
            false
          }
        });

        if is_similar {
          cluster.push(point.clone());
          assigned = true;
          break;
        }
      }

      if !assigned {
        clusters.push(vec![point]);
      }
    } else {
      eprintln!("Failed to get vector for point: {:?}", point.id);
      clusters.push(vec![point]);
    }
  }

  clusters
}

fn get_vector(vectors: &Option<VectorsOutput>) -> Option<&Vec<f32>> {
  match vectors {
    Some(vectors) => match &vectors.vectors_options {
      Some(qdrant_client::qdrant::vectors_output::VectorsOptions::Vector(v)) => {
        if !v.data.is_empty() {
          Some(&v.data)
        } else {
          match &v.vector {
            Some(qdrant_client::qdrant::vector_output::Vector::Dense(d)) => Some(&d.data),
            _ => {
              eprintln!("Inner vector is not Dense: {:?}. Full vectors: {:?}", v.vector, vectors);
              None
            }
          }
        }
      }
      Some(qdrant_client::qdrant::vectors_output::VectorsOptions::Vectors(v)) => {
        if let Some(vector) = v.vectors.values().next() {
          if !vector.data.is_empty() {
            Some(&vector.data)
          } else {
            match &vector.vector {
              Some(qdrant_client::qdrant::vector_output::Vector::Dense(d)) => Some(&d.data),
              _ => {
                eprintln!("Named vector is not Dense: {:?}", vector);
                None
              }
            }
          }
        } else {
          eprintln!("Named vectors map is empty");
          None
        }
      }
      None => {
        eprintln!("VectorsOptions is None");
        None
      }
    },
    None => {
      eprintln!("point.vectors is None");
      None
    }
  }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
  let dot_product: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
  let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
  let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

  if norm_a == 0.0 || norm_b == 0.0 {
    0.0
  } else {
    dot_product / (norm_a * norm_b)
  }
}

fn extract_string_from_payload(payload: &std::collections::HashMap<String, qdrant_client::qdrant::Value>, key: &str) -> Option<String> {
  payload.get(key).and_then(|value| {
    if let Some(qdrant_client::qdrant::value::Kind::StringValue(s)) = &value.kind {
      Some(s.clone())
    } else {
      None
    }
  })
}
