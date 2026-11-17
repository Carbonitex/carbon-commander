import { describe, expectTypeOf, it } from 'vitest';
import type { sendRpc } from '../../src/shared/protocol';
import type { McpServerStatus, SecretName, Settings } from '../../src/shared/types';

// Compile-time checks of the sendRpc signature (tsc --noEmit covers tests/).
describe('sendRpc typing', () => {
  it('infers params and results per method', () => {
    expectTypeOf<ReturnType<typeof sendRpc<'settings.get'>>>().toEqualTypeOf<Promise<Settings>>();
    expectTypeOf<ReturnType<typeof sendRpc<'mcp.add'>>>().toEqualTypeOf<Promise<McpServerStatus>>();
    expectTypeOf<Parameters<typeof sendRpc<'settings.get'>>>().toEqualTypeOf<[method: 'settings.get', params?: undefined]>();
    expectTypeOf<Parameters<typeof sendRpc<'secrets.has'>>[1]>().toEqualTypeOf<{ name: SecretName }>();
  });
});
