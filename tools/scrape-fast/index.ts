import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as cheerio from 'cheerio';
import express from 'express';
import * as z from 'zod/v4';

// Create an MCP server
const server = new McpServer({
  name: `scrape-fast`,
  version: `1.0.0`,
});

server.registerTool(
  `add-f`,
  {
    description: `add two numbers`,
    inputSchema: { a: z.number(), b: z.number() },
    outputSchema: { output: z.number() },
    title: `Add tool`,
  },
  ({ a, b }) => {
    const output = { output: a + b };

    return {
      content: [{ text: JSON.stringify(output), type: `text` }],
      structuredContent: output,
    };
  },
);

server.registerTool(
  `scrape-f`,
  {
    description: `give a website to scrape`,
    inputSchema: { url: z.string() },
    outputSchema: { content: z.string() },
    title: `Web Scraper Tool`,
  },
  async ({ url }) => {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: `text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8`,
          'Accept-Language': `en-US,en;q=0.5`,
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();
      const $ = cheerio.load(html);

      $(`script`).remove();
      $(`style`).remove();
      $(`head`).remove();
      $(`nav`).remove();
      $(`footer`).remove();
      $(`aside`).remove();
      $(`header`).remove();
      $(`noscript`).remove();
      $(`iframe`).remove();
      $(`svg`).remove();
      $(`img`).remove();
      $(`link`).remove();
      $(`meta`).remove();

      const content = $(`body`).text().trim();

      const output = { content };

      return {
        content: [{ text: JSON.stringify(output), type: `text` }],
        structuredContent: output,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `Unknown error`;
      const output = { content: `Error scraping ${url}: ${errorMessage}` };

      return {
        content: [{ text: JSON.stringify(output), type: `text` }],
        structuredContent: output,
      };
    }
  },
);

const app = express();
app.use(express.json());

app.post(`/mcp`, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  res.on(`close`, () => {
    void transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = 3006;

app
  .listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
  })
  .on(`error`, (error) => {
    console.error(`Server error:`, error);
    process.exit(1);
  });
