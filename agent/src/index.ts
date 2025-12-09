import { type } from 'arktype';
import { Elysia } from 'elysia';

import { runAgent } from '@/src/agent/index';
import { registerMcpServers } from '@/src/scheduler/client';

const MCP_SERVER_URLS: string[] = [
  `http://localhost:3005/mcp`,
  `http://localhost:3006/mcp`,
];

const AnswerRequestSchema = type({
  question: `string`,
  scheduler: `boolean?`,
});

const app = new Elysia()
  .get(`/`, () => ({
    message: `Agent API is running`,
    status: `ok`,
  }))
  .get(`/health`, () => ({
    status: `healthy`,
    timestamp: new Date().toISOString(),
  }))
  .post(
    `/agent/answer`,
    async ({ body }) => {
      const { question, scheduler } = AnswerRequestSchema.assert(body);

      console.log(`${scheduler ? `` : `no `}scheduler`);

      console.log(
        `Registering ${MCP_SERVER_URLS.length} MCP server(s) with scheduler...`,
      );

      const response = await registerMcpServers(MCP_SERVER_URLS);

      if (!response) {
        return { answer: `Error` };
      }

      console.log(`${response.message}`);

      if (response.registered_id) {
        console.log(`   Registration ID: ${response.registered_id}`);
      }

      const answer = await runAgent(
        question,
        {
          mcpUrls: response.urls,
          registrationId: response.registered_id!,
        },
        scheduler,
      );

      return { answer };
    },
    {
      body: AnswerRequestSchema,
    },
  )
  .listen(3002);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
export default app;
