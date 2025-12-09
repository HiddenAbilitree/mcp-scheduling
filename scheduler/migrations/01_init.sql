CREATE TABLE IF NOT EXISTS tool_call_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name TEXT NOT NULL,
    mcp_url TEXT NOT NULL,
    total_time_ms BIGINT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_error BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_tool_call_results_mcp_url ON tool_call_results(mcp_url);
CREATE INDEX IF NOT EXISTS idx_tool_call_results_tool_name ON tool_call_results(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_call_results_tool_name_mcp_url ON tool_call_results(tool_name, mcp_url);
