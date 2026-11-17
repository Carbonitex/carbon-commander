import { describe, expect, it } from 'vitest';
import { LEGACY_PROTOCOL_VERSIONS, McpClient } from '../../src/mcp/client';
import { createMockMcpServer } from '../helpers/mock-mcp-server';

describe('servers that negotiate 2024-11-05 over Streamable HTTP', () => {
  it('are accepted (never offered), and their tools work', async () => {
    const server = createMockMcpServer({ era: 'legacy', legacyVersions: ['2024-11-05'] });
    const client = new McpClient({ url: 'https://old.example.com/mcp', fetch: server.fetch });
    const info = await client.connect();
    expect(info).toMatchObject({ era: 'legacy', protocolVersion: '2024-11-05' });
    const init = server.requests.find((r) => r.rpcMethod === 'initialize')?.body as { params: { protocolVersion: string } };
    expect(init.params.protocolVersion).toBe(LEGACY_PROTOCOL_VERSIONS[0]);
    expect((await client.callTool('add', { a: 1, b: 2 })).content).toEqual([{ type: 'text', text: '3' }]);
  });

  it('older versions are still refused', async () => {
    const server = createMockMcpServer({ era: 'legacy', legacyVersions: ['2023-01-01'] });
    const client = new McpClient({ url: 'https://old.example.com/mcp', fetch: server.fetch });
    await expect(client.connect()).rejects.toThrow(/does not support/);
  });
});
