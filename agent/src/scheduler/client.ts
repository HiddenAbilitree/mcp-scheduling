import { ToolSchemaBase } from '@langchain/core/tools';

import { config } from '@/src/config';
import { cleanString } from '@/src/utils';

type LogRequest = {
  is_error: boolean;
  mcp_url: string;
  tool_name: string;
  total_time_ms: number;
};

type RegisterRequest = {
  mcp_urls: string[];
};

type RegisterResponse = {
  message: string;
  registered_id: null | string;
  urls: string[];
};

type SearchToolsQuery = {
  limit?: number;
  query: string;
  score_threshold?: number;
};

type ToolData = {
  mcpUrl: string;
  name: string;
};

type ToolResult = {
  description: string;
  inputSchema?: ToolSchemaBase;
  mcp_url: string;
  name: string;
  score?: number;
};

const registerMcpServers = async (
  urls: string[],
): Promise<RegisterResponse | undefined> => {
  const response = await fetch(`${config.schedulerUrl}/register`, {
    body: JSON.stringify({ mcp_urls: urls } satisfies RegisterRequest),
    headers: {
      'Content-Type': `application/json`,
    },
    method: `POST`,
  });

  if (!response.ok) {
    return;
  }

  return (await response.json()) as RegisterResponse;
};

export const searchTools = async (
  registrationId: string,
): Promise<ToolData[]> => {
  const params = new URLSearchParams({
    batch_id: registrationId,
  });

  const response = await fetch(
    `${config.schedulerUrl}/search?${params.toString()}`,
    {
      headers: {
        'Content-Type': `application/json`,
      },
      method: `GET`,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to search tools: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as ToolResult[];

  console.log(`Fastest Tools:\n${JSON.stringify(data, undefined, 2)}`);

  return data.map((data) => ({ mcpUrl: data.mcp_url, name: data.name }));
};

const logToolCall = async (
  name: string,
  url: string,
  duration: number,
  isError: boolean,
) => {
  const daurl = `${config.schedulerUrl}/log`;

  const realName = name.slice(cleanString(url).length + 2);

  const response = await fetch(daurl, {
    body: JSON.stringify({
      is_error: isError,
      mcp_url: url,
      tool_name: realName,
      total_time_ms: duration,
    } satisfies LogRequest),
    headers: {
      'Content-Type': `application/json`,
    },
    method: `POST`,
  });

  if (!response.ok) {
    console.log(`Failed to log tool call for ${realName} from ${url}`);
    return;
  }

  console.log(`Successfully logged tool call for ${realName} from ${url}`);
  return (await response.json()) as RegisterResponse;
};

export { logToolCall, registerMcpServers };
export type {
  RegisterRequest,
  RegisterResponse,
  SearchToolsQuery,
  ToolData,
  ToolResult,
};
