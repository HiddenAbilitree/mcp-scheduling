use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::{DEFAULT_EMBEDDING_MODEL, OPENROUTER_API_KEY, OPENROUTER_EMBEDDINGS_URL};

#[derive(Serialize)]
struct EmbeddingRequest {
  model: String,
  input: Vec<String>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
  data: Vec<EmbeddingData>,
}

#[derive(Deserialize)]
struct EmbeddingData {
  embedding: Vec<f32>,
}

pub async fn generate_embedding(description: &str) -> Result<Vec<f32>> {
  generate_embedding_with_model(description, DEFAULT_EMBEDDING_MODEL).await
}

pub async fn generate_embedding_with_model(description: &str, model: &str) -> Result<Vec<f32>> {
  let client = Client::new();
  let request_body = EmbeddingRequest {
    model: model.to_string(),
    input: vec![description.to_string()],
  };

  let response = client
    .post(OPENROUTER_EMBEDDINGS_URL)
    .header("Authorization", format!("Bearer {}", OPENROUTER_API_KEY))
    .header("Content-Type", "application/json")
    .json(&request_body)
    .send()
    .await?;

  if !response.status().is_success() {
    let status = response.status();
    let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
    anyhow::bail!("OpenRouter API error ({}): {}", status, error_text);
  }

  let embedding_response: EmbeddingResponse = response.json().await?;

  embedding_response
    .data
    .first()
    .map(|data| data.embedding.clone())
    .ok_or_else(|| anyhow::anyhow!("No embedding data found in response"))
}
