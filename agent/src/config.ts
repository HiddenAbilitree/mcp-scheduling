export interface Config {
  llmProvider: LLMProvider;
  ollamaModel: string;
  openrouterApiKey: string | undefined;
  openrouterModel: string;
  schedulerUrl: string;
}

export type LLMProvider = `ollama` | `openrouter`;

export const config: Config = {
  llmProvider: (process.env.LLM_PROVIDER as LLMProvider) || `ollama`,
  ollamaModel: process.env.OLLAMA_MODEL ?? `gpt-oss:latest`,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel:
    process.env.OPENROUTER_MODEL ?? `google/gemini-2.0-flash-001`,
  schedulerUrl: process.env.SCHEDULER_URL ?? `http://localhost:4000`,
};

if (config.llmProvider === `openrouter` && !config.openrouterApiKey) {
  console.warn(
    `LLM_PROVIDER is set to "openrouter" but OPENROUTER_API_KEY is not set.`,
  );
}
