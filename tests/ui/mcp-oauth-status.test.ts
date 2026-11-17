import { describe, expect, it } from 'vitest';
import { approximateSite } from '../../src/mcp/oauth';
import type { McpSignInPlan } from '../../src/shared/types';
import { describeOAuth, describePlan } from '../../src/ui/settings/mcp';

describe('describeOAuth', () => {
  const now = new Date('2026-11-17T10:00:00').getTime();
  it('names the three main states the user must tell apart', () => {
    expect(describeOAuth({ state: 'required', issuer: 'https://auth.example.com' }, now)).toMatchObject({ pill: 'sign-in required', text: 'Sign-in required with auth.example.com.' });
    const signedIn = describeOAuth({ state: 'signed-in', issuer: 'https://auth.example.com', expiresAt: now + 3600_000 }, now);
    expect(signedIn.pill).toBe('signed in');
    expect(signedIn.text).toMatch(/^Signed in with auth\.example\.com \(expires /);
    expect(describeOAuth({ state: 'failed', error: 'Access was denied' }, now)).toMatchObject({ pill: 'sign-in failed', tone: 'error', text: 'Sign-in failed: Access was denied' });
  });
  it('explains refresh, step-up and interruption', () => {
    expect(describeOAuth({ state: 'signed-in', expiresAt: now + 60_000, canRefresh: true }, now).text).toMatch(/renews automatically/);
    expect(describeOAuth({ state: 'insufficient-scope', requiredScope: 'admin' }, now).text).toMatch(/\(admin\)/);
    expect(describeOAuth({ state: 'interrupted' }, now).pill).toBe('sign-in interrupted');
  });
});

describe('describePlan', () => {
  const base: McpSignInPlan = {
    authorizationHost: 'auth.example.com',
    issuer: 'https://auth.example.com',
    serverHost: 'mcp.example.com',
    crossSite: false,
    scopeSource: 'resource-metadata',
    scopes: ['read', 'write'],
    selected: ['read', 'write'],
    required: [],
  };
  it('names the host the window opens, calls out another site, and says what is requested', () => {
    expect(describePlan(base)).toEqual({
      opens: 'Sign-in opens a window at auth.example.com.',
      site: null,
      scopes: 'Requests the checked scopes (the server lists these); uncheck what you do not want to grant.',
    });
    const cross = describePlan({ ...base, authorizationHost: 'login.other.test', issuer: 'https://id.other.test', crossSite: true, scopes: ['mcp'], scopeSource: 'challenge' });
    expect(cross.opens).toBe('Sign-in opens a window at login.other.test (authorization server id.other.test).');
    expect(cross.site).toMatch(/^login\.other\.test is a different site from the MCP server mcp\.example\.com\./);
    expect(cross.scopes).toBe('Requests the scope mcp (the server asked for these).');
    expect(describePlan({ ...base, scopes: [], selected: [], scopeSource: 'none' }).scopes).toMatch(/no specific scope/);
  });
});

describe('approximateSite', () => {
  it('groups hosts by registrable domain (approximately)', () => {
    expect(approximateSite('mcp.stripe.com')).toBe(approximateSite('access.stripe.com'));
    expect(approximateSite('a.example.co.uk')).toBe('example.co.uk');
    expect(approximateSite('a.example.co.uk')).not.toBe(approximateSite('b.other.co.uk'));
    expect(approximateSite('127.0.0.1')).toBe('127.0.0.1');
    expect(approximateSite('localhost')).toBe('localhost');
    expect(approximateSite('api.githubcopilot.com')).not.toBe(approximateSite('github.com'));
  });
});
