/**
 * Token resolution tests for Google Workspace authentication.
 * Covers session lookup, credential-keyed caching, and TTL expiry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  createChildContext,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';

// Mock jwt and exchange modules before importing resolve
vi.mock('../src/auth/jwt.js', () => ({
  signServiceAccountJwt: vi.fn(),
}));

vi.mock('../src/auth/exchange.js', () => ({
  exchangeJwtForToken: vi.fn(),
  exchangeJwtForAccessToken: vi.fn(),
  exchangeRefreshToken: vi.fn(),
}));

import {
  resolveToken,
  createTokenCache,
  clearTokenCache,
} from '../src/auth/resolve.js';
import { signServiceAccountJwt } from '../src/auth/jwt.js';
import {
  exchangeJwtForToken,
  exchangeRefreshToken,
} from '../src/auth/exchange.js';

const mockSign = vi.mocked(signServiceAccountJwt);
const mockExchange = vi.mocked(exchangeJwtForToken);
const mockRefresh = vi.mocked(exchangeRefreshToken);

// Reset all mocks before every test to prevent cross-test bleed
beforeEach(() => {
  mockSign.mockReset();
  mockExchange.mockReset();
  mockRefresh.mockReset();
});

// A valid service account keyJson
const VALID_KEY_JSON = JSON.stringify({
  client_email: 'sa@project.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const SIGNAL = new AbortController().signal;
const TTL_MS = (3600 - 300) * 1000;

// ============================================================
// createTokenCache / clearTokenCache
// ============================================================

describe('clearTokenCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empties the cache when slots are populated', async () => {
    mockSign.mockReturnValue('jwt');
    mockExchange.mockResolvedValue({ accessToken: 'tok', expiresIn: 3600 });
    const cache = createTokenCache();
    await resolveToken(
      { type: 'service-account', keyJson: VALID_KEY_JSON },
      createRuntimeContext(),
      cache,
      SCOPES,
      SIGNAL
    );
    expect(cache.slots.size).toBe(1);

    clearTokenCache(cache);

    expect(cache.slots.size).toBe(0);
  });

  it('is idempotent: safe to call when slot is already null', () => {
    const cache = createTokenCache();
    clearTokenCache(cache);
    expect(cache.slots.size).toBe(0);
  });

  it('re-signs on next service-account call after clearTokenCache', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    mockSign.mockReturnValue('jwt-assertion');
    mockExchange.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresIn: 3600,
    });

    const cache = createTokenCache();
    // Populate the cache
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    await resolveToken(auth, createRuntimeContext(), cache, SCOPES, SIGNAL);
    expect(mockSign).toHaveBeenCalledTimes(1);

    // Clear the cache
    clearTokenCache(cache);
    expect(cache.slots.size).toBe(0);

    // Next call must re-sign
    mockSign.mockClear();
    mockExchange.mockClear();
    mockSign.mockReturnValue('jwt-assertion-2');
    mockExchange.mockResolvedValue({
      accessToken: 'fresh-token-2',
      expiresIn: 3600,
    });

    await resolveToken(auth, createRuntimeContext(), cache, SCOPES, SIGNAL);
    expect(mockSign).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// resolveToken — bearer branch
// ============================================================

describe('resolveToken — bearer', () => {
  it('returns auth.token directly without any I/O', async () => {
    const auth = { type: 'bearer' as const, token: 'static-bearer-token' };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('static-bearer-token');
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockExchange).not.toHaveBeenCalled();
  });
});

// ============================================================
// resolveToken — session branch
// ============================================================

describe('resolveToken — session', () => {
  const auth = { type: 'session' as const, tokenVar: 'MY_TOKEN' };

  async function catchThrown(ctx: ReturnType<typeof createRuntimeContext>) {
    let caught: unknown;
    try {
      await resolveToken(auth, ctx, createTokenCache(), SCOPES, SIGNAL);
    } catch (e) {
      caught = e;
    }
    return caught as RillValue;
  }

  it('returns the token from hostContext', async () => {
    const ctx = createRuntimeContext({
      hostContext: { MY_TOKEN: 'session-token-value' },
    });

    const result = await resolveToken(
      auth,
      ctx,
      createTokenCache(),
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('session-token-value');
  });

  it('inherits hostContext in a child context', async () => {
    const parent = createRuntimeContext({
      hostContext: { MY_TOKEN: 'parent-token' },
    });
    const child = createChildContext(createChildContext(parent));

    const result = await resolveToken(
      auth,
      child,
      createTokenCache(),
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('parent-token');
  });

  it('emits #AUTH when the key is absent from hostContext', async () => {
    const caught = await catchThrown(createRuntimeContext());

    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('AUTH');
    expect(getStatus(caught).message).toBe(
      "google: session token 'MY_TOKEN' not found"
    );
    expect(getStatus(caught).raw['kind']).toBe('session_token_missing');
  });

  it('emits session_token_missing when the token is only a script variable', async () => {
    const caught = await catchThrown(
      createRuntimeContext({ variables: { MY_TOKEN: 'script-token' } })
    );

    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).raw['kind']).toBe('session_token_missing');
  });

  it('prefers the hostContext value when a script variable is also set', async () => {
    const ctx = createRuntimeContext({
      variables: { MY_TOKEN: 'script-token' },
      hostContext: { MY_TOKEN: 'host-token' },
    });

    const result = await resolveToken(
      auth,
      ctx,
      createTokenCache(),
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('host-token');
  });

  it('emits #AUTH invalid_session_token when the value is not a string', async () => {
    const caught = await catchThrown(
      createRuntimeContext({ hostContext: { MY_TOKEN: 42 } })
    );

    expect(isInvalid(caught)).toBe(true);
    const status = getStatus(caught);
    expect(status.code.name).toBe('AUTH');
    expect(status.raw['kind']).toBe('invalid_session_token');
  });

  it('leaves the token cache empty in session mode', async () => {
    const cache = createTokenCache();
    const ctx = createRuntimeContext({ hostContext: { MY_TOKEN: 'tok' } });

    await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(cache.slots.size).toBe(0);
  });
});

// ============================================================
// resolveToken — service-account branch
// ============================================================

describe('resolveToken — service-account', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls signServiceAccountJwt and exchangeJwtForToken on cache miss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);

    mockSign.mockReturnValue('signed-jwt');
    mockExchange.mockResolvedValue({
      accessToken: 'new-token',
      expiresIn: 3600,
    });

    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('new-token');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledWith(
      expect.anything(),
      'signed-jwt',
      SIGNAL
    );
  });

  it('serves a call from cache at expiry - 1 ms without signing again', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    mockSign.mockReturnValue('signed-jwt');
    mockExchange.mockResolvedValue({
      accessToken: 'cached-token',
      expiresIn: 3600,
    });
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    vi.setSystemTime(now + TTL_MS - 1);
    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('cached-token');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  it('mints again at exact expiry because the check is strict', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    mockSign.mockReturnValue('jwt');
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'first', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'second', expiresIn: 3600 });
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    vi.setSystemTime(now + TTL_MS);
    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('second');
    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(mockExchange).toHaveBeenCalledTimes(2);
  });

  it('applies a fresh TTL after re-minting', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    mockSign.mockReturnValue('jwt');
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'first', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'second', expiresIn: 3600 });
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    vi.setSystemTime(now + TTL_MS);
    await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    vi.setSystemTime(now + TTL_MS + TTL_MS - 1);
    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('second');
    expect(mockExchange).toHaveBeenCalledTimes(2);
  });

  it('emits #AUTH without key material when keyJson parse fails (no key in message)', async () => {
    const auth = {
      type: 'service-account' as const,
      keyJson: 'not-valid-json',
    };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    } catch (e) {
      caught = e;
    }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
    expect(getStatus(caught as RillValue).message).toContain(
      'google: service account key parse failed'
    );
    expect(getStatus(caught as RillValue).message).not.toContain(
      '-----BEGIN PRIVATE KEY-----'
    );
  });
});

// ============================================================
// resolveToken — oauth-refresh branch
// ============================================================

const OAUTH_REFRESH_AUTH = {
  type: 'oauth-refresh' as const,
  client_id: 'cid',
  client_secret: 'csec',
  refresh_token: 'rtok',
};

describe('resolveToken — oauth-refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls exchangeRefreshToken and returns token on cache miss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);

    mockRefresh.mockResolvedValue({
      accessToken: 'refresh-access-token',
      expiresIn: 3600,
    });

    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const result = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('refresh-access-token');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(
      'cid',
      'csec',
      'rtok',
      ctx,
      SIGNAL
    );
  });

  it('serves a call from cache at expiry - 1 ms without exchanging again', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    mockRefresh.mockResolvedValue({
      accessToken: 'refresh-hit-token',
      expiresIn: 3600,
    });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    await resolveToken(OAUTH_REFRESH_AUTH, ctx, cache, SCOPES, SIGNAL);

    vi.setSystemTime(now + TTL_MS - 1);
    const result = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('refresh-hit-token');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('exchanges again at exact expiry because the check is strict', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    mockRefresh
      .mockResolvedValueOnce({ accessToken: 'first', expiresIn: 3600 })
      .mockResolvedValueOnce({
        accessToken: 'new-refresh-token',
        expiresIn: 3600,
      });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    await resolveToken(OAUTH_REFRESH_AUTH, ctx, cache, SCOPES, SIGNAL);

    vi.setSystemTime(now + TTL_MS);
    const result = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('new-refresh-token');
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// resolveToken — credential-keyed cache
// ============================================================

describe('resolveToken — credential-keyed cache', () => {
  const OTHER_KEY_JSON = JSON.stringify({
    ...(JSON.parse(VALID_KEY_JSON) as Record<string, unknown>),
    private_key: 'other-private-key-material',
  });

  beforeEach(() => {
    mockSign.mockReturnValue('jwt');
  });

  function saAuth(keyJson: string, subject?: string) {
    return subject === undefined
      ? { type: 'service-account' as const, keyJson }
      : { type: 'service-account' as const, keyJson, subject };
  }

  it('mints separately for service accounts with different keyJson sharing one cache', async () => {
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'token-a', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'token-b', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const a1 = await resolveToken(
      saAuth(VALID_KEY_JSON),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const b1 = await resolveToken(
      saAuth(OTHER_KEY_JSON),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const a2 = await resolveToken(
      saAuth(VALID_KEY_JSON),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const b2 = await resolveToken(
      saAuth(OTHER_KEY_JSON),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect([a1, b1, a2, b2]).toEqual([
      'token-a',
      'token-b',
      'token-a',
      'token-b',
    ]);
    expect(mockExchange).toHaveBeenCalledTimes(2);
    expect(cache.slots.size).toBe(2);
  });

  it('mints separately for the same keyJson with different subjects', async () => {
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'token-u1', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'token-u2', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const u1 = await resolveToken(
      saAuth(VALID_KEY_JSON, 'u1@x.com'),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const u2 = await resolveToken(
      saAuth(VALID_KEY_JSON, 'u2@x.com'),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect([u1, u2]).toEqual(['token-u1', 'token-u2']);
    expect(mockExchange).toHaveBeenCalledTimes(2);
  });

  it('mints separately for no subject and an empty subject', async () => {
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'token-none', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'token-empty', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    await resolveToken(saAuth(VALID_KEY_JSON), ctx, cache, SCOPES, SIGNAL);
    await resolveToken(saAuth(VALID_KEY_JSON, ''), ctx, cache, SCOPES, SIGNAL);

    expect(mockExchange).toHaveBeenCalledTimes(2);
  });

  it('mints separately for oauth-refresh auths with different refresh tokens', async () => {
    mockRefresh
      .mockResolvedValueOnce({ accessToken: 'token-r1', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'token-r2', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    const r1 = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const r2 = await resolveToken(
      { ...OAUTH_REFRESH_AUTH, refresh_token: 'rtok-2' },
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    const r1Again = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect([r1, r2, r1Again]).toEqual(['token-r1', 'token-r2', 'token-r1']);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('caches the same credential separately per scope set and ignores scope order', async () => {
    mockExchange
      .mockResolvedValueOnce({ accessToken: 'token-s1', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'token-s2', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    const auth = saAuth(VALID_KEY_JSON);
    const wide = ['scope-a', 'scope-b'];

    const narrow = await resolveToken(auth, ctx, cache, ['scope-a'], SIGNAL);
    const first = await resolveToken(auth, ctx, cache, wide, SIGNAL);
    const reordered = await resolveToken(
      auth,
      ctx,
      cache,
      [...wide].reverse(),
      SIGNAL
    );

    expect([narrow, first, reordered]).toEqual([
      'token-s1',
      'token-s2',
      'token-s2',
    ]);
    expect(cache.slots.size).toBe(2);
  });

  it('keeps private_key and refresh_token material out of every slots key', async () => {
    mockExchange.mockResolvedValue({ accessToken: 'tok', expiresIn: 3600 });
    mockRefresh.mockResolvedValue({ accessToken: 'tok', expiresIn: 3600 });
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    const privateKey = (JSON.parse(VALID_KEY_JSON) as { private_key: string })
      .private_key;

    await resolveToken(
      saAuth(VALID_KEY_JSON, 'user@x.com'),
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );
    await resolveToken(OAUTH_REFRESH_AUTH, ctx, cache, SCOPES, SIGNAL);

    expect(cache.slots.size).toBe(2);
    for (const key of cache.slots.keys()) {
      expect(key).not.toContain(privateKey);
      expect(key).not.toContain('PRIVATE KEY');
      expect(key).not.toContain(OAUTH_REFRESH_AUTH.refresh_token);
      expect(key).not.toContain('user@x.com');
    }
  });
});
