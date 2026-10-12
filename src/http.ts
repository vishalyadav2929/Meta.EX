// Remote use: one URL for Claude (custom connector) and ChatGPT (developer mode connector).
// Stateless Streamable HTTP: a fresh server + transport per request.
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { buildServer } from "./server.js";

const app = createMcpExpressApp({ host: "0.0.0.0" });
// v1 has no OAuth: an unguessable path segment keeps strangers out. Replace with OAuth before multi-client use.
const mcpPath = config.mcpPathSecret ? `/mcp/${config.mcpPathSecret}` : "/mcp";

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, writes: config.writesEnabled });
});

app.post(mcpPath, async (req: Request, res: Response) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

const notAllowed = (_req: Request, res: Response) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get(mcpPath, notAllowed);
app.delete(mcpPath, notAllowed);

app.listen(config.port, () => {
  if (!config.mcpPathSecret) console.warn("MCP_PATH_SECRET is not set: the endpoint is open to anyone with the URL.");
  console.log(`meta-ex MCP listening on :${config.port}${config.mcpPathSecret ? "/mcp/<secret>" : "/mcp"}`);
});
