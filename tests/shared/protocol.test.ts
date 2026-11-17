import { describe, expect, it } from 'vitest';
import {
  dispatchRpc,
  isFrameToHostMessage,
  isRpcRequest,
  isUiToSwMessage,
} from '../../src/shared/protocol';
import { CcError, toErrorInfo } from '../../src/shared/types';
import { DEFAULT_OPENROUTER_MODELS, DEFAULT_SETTINGS, MODEL_ROLES } from '../../src/shared/defaults';

const sender = {} as chrome.runtime.MessageSender;

describe('dispatchRpc', () => {
  it('returns the handler result', async () => {
    const res = await dispatchRpc({ 'secrets.has': () => true }, { rpc: 'secrets.has', params: { name: 'openrouter-key' } }, sender);
    expect(res).toEqual({ ok: true, result: true });
  });

  it('maps thrown errors to ErrorInfo', async () => {
    const res = await dispatchRpc(
      {
        'settings.get': () => {
          throw new CcError('invalid', 'nope');
        },
      },
      { rpc: 'settings.get', params: undefined },
      sender,
    );
    expect(res).toEqual({ ok: false, error: { code: 'invalid', message: 'nope' } });
  });

  it('answers not-implemented for missing handlers', async () => {
    const res = await dispatchRpc({}, { rpc: 'mcp.list', params: undefined }, sender);
    expect(res).toMatchObject({ ok: false, error: { code: 'not-implemented' } });
  });
});

describe('message guards', () => {
  it('recognises port, RPC and frame messages', () => {
    expect(isUiToSwMessage({ type: 'run.start', text: 'hi' })).toBe(true);
    expect(isUiToSwMessage({ type: 'session.state' })).toBe(false);
    expect(isRpcRequest({ rpc: 'settings.get' })).toBe(true);
    expect(isRpcRequest({ type: 'x' })).toBe(false);
    expect(isFrameToHostMessage({ cc: 'resize', height: 300 })).toBe(true);
    expect(isFrameToHostMessage({ cc: 'resize', height: 'x' })).toBe(false);
    expect(isFrameToHostMessage({ cc: 'close' })).toBe(true);
  });

  it('toErrorInfo handles aborts, errors and junk', () => {
    expect(toErrorInfo(new DOMException('x', 'AbortError')).code).toBe('aborted');
    expect(toErrorInfo(new CcError('http', 'bad', { status: 502 }))).toEqual({ code: 'http', message: 'bad', status: 502 });
    expect(toErrorInfo('str')).toEqual({ code: 'unknown', message: 'str' });
  });
});

describe('defaults', () => {
  it('has an OpenRouter default for every role', () => {
    for (const role of MODEL_ROLES) {
      expect(DEFAULT_OPENROUTER_MODELS[role]).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(DEFAULT_SETTINGS.models[role]).toEqual({ provider: 'openrouter', model: DEFAULT_OPENROUTER_MODELS[role] });
    }
  });
});
