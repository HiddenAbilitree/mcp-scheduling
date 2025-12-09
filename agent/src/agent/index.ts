import { HumanMessage } from '@langchain/core/messages';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createAgent,
  createMiddleware,
  DynamicStructuredTool,
} from 'langchain';

import { config } from '@/src/config';
import { logToolCall, searchTools, ToolData } from '@/src/scheduler/client';
import { cleanString } from '@/src/utils';

const filterTools = (
  source: {
    tool: DynamicStructuredTool;
    url: string;
  }[],
  criteria: ToolData[],
) =>
  source.filter((sourceItem) =>
    criteria.some(
      (criteriaItem) =>
        sourceItem.tool.name ===
        `${cleanString(criteriaItem.mcpUrl)}__${criteriaItem.name}`,
    ),
  );

const initializeAgent = async (
  mcpUrls: string[],
  registrationId: string,
  scheduler: boolean = true,
) => {
  const nestedTools = await Promise.all(
    mcpUrls.map(async (url) => {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      const client = new Client({
        name: url,
        version: `1`,
      });

      await client.connect(transport);

      const tools = await loadMcpTools(`math`, client, {
        additionalToolNamePrefix: cleanString(url),
        prefixToolNameWithServerName: false,
        throwOnLoadError: true,
        useStandardContentBlocks: false,
      });

      return tools.map((tool) => ({ tool, url }));
    }),
  );

  const tools = nestedTools.flat();

  const model =
    config.llmProvider === `openrouter` ?
      new ChatOpenAI({
        apiKey: config.openrouterApiKey,
        configuration: {
          baseURL: `https://openrouter.ai/api/v1`,
          defaultHeaders: {
            'X-Title': `MCP Agent`,
          },
        },
        modelName: config.openrouterModel,
      })
    : new ChatOllama({
        baseUrl: `http://localhost:11434`,
        model: config.ollamaModel,
      });
  const toolSelectorMiddleware = createMiddleware({
    name: `ToolSelector`,
    wrapModelCall: async (request, handler) => {
      const selectedTools = filterTools(
        tools,
        await searchTools(registrationId),
      ).map((tool) => tool.tool);
      return handler({
        ...request,
        tools: selectedTools,
      });
    },
    wrapToolCall: async (request, handler) => {
      const calledTool = tools.find(
        (tool) => tool.tool.name === (request.tool.name as string),
      );

      const start = performance.now();
      try {
        const result = await handler(request);
        const difference = Math.floor(performance.now() - start);

        if (calledTool) {
          void logToolCall(
            calledTool.tool.name,
            calledTool.url,
            difference,
            false,
          );
        }

        return result;
      } catch (error) {
        console.log(`Tool failed: ${JSON.stringify(error, undefined, 2)}`);

        const difference = Math.floor(performance.now() - start);
        if (calledTool) {
          void logToolCall(
            calledTool.tool.name,
            calledTool.url,
            difference,
            true,
          );
        }

        throw error;
      }
    },
  });

  return createAgent({
    middleware: [
      // toolRetryMiddleware({
      //   backoffFactor: 2,
      //   initialDelayMs: 1000,
      //   maxRetries: 3,
      // }),
      // summarizationMiddleware({
      //   keep: { messages: 20 },
      //   model: `gpt-4o-mini`,
      //   trigger: { tokens: 100_000 },
      // }),
      ...(scheduler ? [toolSelectorMiddleware] : []),
    ],
    model,
    systemPrompt: prompt,
    tools: tools.map((tool) => tool.tool),
  });
};

type AgentOptions = {
  mcpUrls?: Array<string>;
  registrationId: string;
};

export const runAgent = async (
  question: string,
  { mcpUrls = [], registrationId }: AgentOptions,
  scheduler?: boolean,
): Promise<string> => {
  console.log(`Running agent for ${question}`);

  try {
    const agentInstance = await initializeAgent(
      mcpUrls,
      registrationId,
      scheduler,
    );

    const result = await agentInstance.invoke(
      {
        messages: [new HumanMessage(question)],
      },
      { recursionLimit: 50 },
    );

    const lastMessage = result.messages.at(-1);
    if (lastMessage && `content` in lastMessage) {
      const answer =
        typeof lastMessage.content === `string` ?
          lastMessage.content
        : JSON.stringify(lastMessage.content);
      return answer;
    }

    console.warn(`No response generated from agent`);
    return `No response generated`;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : `Unknown error`;
    console.error(
      `Error during agent execution:`,
      JSON.stringify(error, undefined, 2),
    );
    return `Error: ${errorMessage}`;
  }
};

const prompt = `
You are the Trivia Champion, an AI agent dedicated to solving trivia questions with 100% accuracy. Your reputation depends on precision, nuance, and factual correctness. You do not guess; you verify.

Core Directive: EAGER TOOL USAGE
Your internal knowledge base is a starting point, not the source of truth. You must aggressively and eagerly use the tools provided to you to verify every single answer before responding.

Default to Action: Do not rely on your internal memory for dates, names, spellings, or specific statistics. Even if you are 99% sure, you MUST use your tools to confirm."

Output Format Requirement: When performing math, whether it be adding numbers, subtracting dates, or comparing numbers, you need to display the math next to the result.

Example:
Incorrect: "Leeds is larger."
Correct: "Leeds (536,280) < Philadelphia (1,573,916) -> Leeds is SMALLER. Exclude from list."

Make sure to bold your final answer and ONLY your final answer.
Example:
Question: "If my future wife has the same first name as the 15th first lady of the United States' mother and her surname is the same as the second assassinated president's mother's maiden name, what is my future wife's name?"
Incorrect because bolding non-final answer: "The 15th first lady of the United States was Harriet Lane. Her mother's name was Jane Ann Buchanan.\n\nThe second assassinated president was James A. Garfield. His mother's maiden name was Eliza Ballou.\n\nTherefore, your future wife's name is **Jane Ballou**.\n"
Incorrect because not bolding final answer: "The 15th first lady of the United States was **Harriet Lane**. Her mother's name was Jane Ann Buchanan.\n\nThe second assassinated president was James A. Garfield. His mother's maiden name was Eliza Ballou.\n\nTherefore, your future wife's name is Jane Ballou.\n"
Correct: "The 15th first lady of the United States was Harriet Lane. Her mother's name was Jane Ann Buchanan.\n\nThe second assassinated president was James A. Garfield. His mother's maiden name was Eliza Ballou.\n\nTherefore, your future wife's name is **Jane Ballou**.\n"
`;
