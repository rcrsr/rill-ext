/**
 * Token resolution tests for Google Workspace authentication.
 * Covers: IR-21, EC-21, AC-10, BC-6, BC-7.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import {} from '@rcrsr/rill';

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
import type { TokenCache } from '../src/auth/resolve.js';

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
// The cache keys token slots by scope set; all tests use SCOPES.
const SLOT_KEY = [...SCOPES].sort().join(' ');

// ============================================================
// createTokenCache / clearTokenCache
// ============================================================

describe('createTokenCache', () => {
  it('returns a cache with slot = null', () => {
    const cache = createTokenCache();
    expect(cache.slots.size).toBe(0);
  });
});

describe('clearTokenCache', () => {
  it('sets slot to null when slot has a value (AC-10)', () => {
    const cache: TokenCache = {
      slots: new Map([
        [SLOT_KEY, { accessToken: 'tok', expiresAtMs: Date.now() + 60_000 }],
      ]),
    };
    clearTokenCache(cache);
    expect(cache.slots.size).toBe(0);
  });

  it('is idempotent: safe to call when slot is already null (AC-10)', () => {
    const cache = createTokenCache();
    clearTokenCache(cache);
    expect(cache.slots.size).toBe(0);
  });

  it('re-signs on next service-account call after clearTokenCache (AC-10)', async () => {
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

    vi.useRealTimers();
  });
});

// ============================================================
// resolveToken — bearer branch (IR-21)
// ============================================================

describe('resolveToken — bearer', () => {
  it('returns auth.token directly without any I/O (IR-21)', async () => {
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
// resolveToken — session branch (IR-21, EC-21)
// ============================================================

describe('resolveToken — session', () => {
  it('returns the token from the direct context scope (IR-21)', async () => {
    const auth = { type: 'session' as const, tokenVar: 'MY_TOKEN' };
    const cache = createTokenCache();
    const ctx = createRuntimeContext({
      variables: { MY_TOKEN: 'session-token-value' },
    });

    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('session-token-value');
  });

  it('walks ctx.parent chain and returns token from parent scope (IR-21)', async () => {
    const auth = { type: 'session' as const, tokenVar: 'MY_TOKEN' };
    const cache = createTokenCache();
    const parent = createRuntimeContext({
      variables: { MY_TOKEN: 'parent-token' },
    });
    const child = createRuntimeContext();
    child.parent = parent;

    const result = await resolveToken(auth, child, cache, SCOPES, SIGNAL);

    expect(result).toBe('parent-token');
  });

  it('returns token from grandparent scope when parent has no match (IR-21)', async () => {
    const auth = { type: 'session' as const, tokenVar: 'MY_TOKEN' };
    const cache = createTokenCache();
    const grandparent = createRuntimeContext({
      variables: { MY_TOKEN: 'grandparent-token' },
    });
    const parent = createRuntimeContext();
    const child = createRuntimeContext();
    parent.parent = grandparent;
    child.parent = parent;

    const result = await resolveToken(auth, child, cache, SCOPES, SIGNAL);

    expect(result).toBe('grandparent-token');
  });

  it('emits #AUTH when session variable is absent from all scopes (EC-21)', async () => {
    const auth = { type: 'session' as const, tokenVar: 'MISSING_TOKEN' };
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
    expect(getStatus(caught as RillValue).message).toBe(
      "google: session token 'MISSING_TOKEN' not found"
    );
  });

  it('session token error with exact var name in message (EC-21)', async () => {
    const auth = { type: 'session' as const, tokenVar: 'gcp_access_token' };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();
    let caught: unknown;
    try {
      await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    } catch (e) {
      caught = e;
    }
    expect(getStatus(caught as RillValue).message).toBe(
      "google: session token 'gcp_access_token' not found"
    );
  });
});

// ============================================================
// resolveToken — service-account branch (BC-6, BC-7, AC-10)
// ============================================================

describe('resolveToken — service-account', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls signServiceAccountJwt and exchangeJwtForToken on cache miss (BC-7)', async () => {
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

  it('populates cache with expiresAtMs = Date.now() + (expiresIn - 300) * 1000 (BC-7, AC-10)', async () => {
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

    expect(cache.slots.get(SLOT_KEY)).toBeDefined();
    expect(cache.slots.get(SLOT_KEY)!.accessToken).toBe('cached-token');
    expect(cache.slots.get(SLOT_KEY)!.expiresAtMs).toBe(
      now + (3600 - 300) * 1000
    );
  });

  it('returns cached token on cache hit without calling sign or exchange (BC-6)', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    const futureExpiry = now + 1000;
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache: TokenCache = {
      slots: new Map([
        [SLOT_KEY, { accessToken: 'cached-token', expiresAtMs: futureExpiry }],
      ]),
    };
    const ctx = createRuntimeContext();

    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('cached-token');
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('does not use expired cache: calls sign + exchange when expiresAtMs <= Date.now() (BC-6)', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    // Set expired slot (expiresAtMs exactly equals now — not strictly greater)
    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache: TokenCache = {
      slots: new Map([
        [SLOT_KEY, { accessToken: 'stale-token', expiresAtMs: now }],
      ]),
    };
    const ctx = createRuntimeContext();

    mockSign.mockReturnValue('new-jwt');
    mockExchange.mockResolvedValue({
      accessToken: 'refreshed-token',
      expiresIn: 3600,
    });

    const result = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);

    expect(result).toBe('refreshed-token');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  it('BC-6 depth: two sequential calls within TTL — sign and exchange each called once', async () => {
    // BC-6: second call within TTL reuses cached token; no re-sign or re-exchange occurs.
    // This verifies mock call counts across N=2 calls, not a pre-seeded cache.
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    mockSign.mockReturnValue('jwt-for-bc6');
    mockExchange.mockResolvedValue({
      accessToken: 'token-bc6',
      expiresIn: 3600,
    });

    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    // First call: cache miss → sign + exchange fire once
    const first = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    expect(first).toBe('token-bc6');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);

    // Advance time by 1 second (well within the TTL = (3600 - 300) * 1000 = 3_300_000 ms)
    vi.setSystemTime(now + 1_000);

    // Second call: cache hit → no additional sign or exchange
    const second = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    expect(second).toBe('token-bc6');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  it('BC-7 depth: two calls separated by TTL expiry — sign and exchange each called twice', async () => {
    // BC-7: after TTL expires, re-signs JWT and re-exchanges token; new TTL applied.
    // Fast-forward time past TTL = (expiresIn - 300) seconds between calls.
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    mockSign.mockReturnValue('jwt-call-1');
    mockExchange.mockResolvedValue({
      accessToken: 'token-call-1',
      expiresIn: 3600,
    });

    const auth = { type: 'service-account' as const, keyJson: VALID_KEY_JSON };
    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    // First call: cache miss → populates cache with TTL = (3600 - 300) * 1000 ms
    const first = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    expect(first).toBe('token-call-1');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledTimes(1);

    // Advance past TTL: TTL = 3300 s = 3_300_000 ms; advance by 3_300_001 ms
    const ttlMs = (3600 - 300) * 1000;
    vi.setSystemTime(now + ttlMs + 1);

    // Prepare second-call mocks
    mockSign.mockReturnValue('jwt-call-2');
    mockExchange.mockResolvedValue({
      accessToken: 'token-call-2',
      expiresIn: 3600,
    });

    // Second call: cache expired → re-signs and re-exchanges
    const second = await resolveToken(auth, ctx, cache, SCOPES, SIGNAL);
    expect(second).toBe('token-call-2');
    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(mockExchange).toHaveBeenCalledTimes(2);

    // New cache slot should reflect fresh token
    expect(cache.slots.get(SLOT_KEY)!.accessToken).toBe('token-call-2');
    expect(cache.slots.get(SLOT_KEY)!.expiresAtMs).toBe(
      now + ttlMs + 1 + ttlMs
    );
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
// resolveToken — oauth-refresh branch (BC-6, BC-7, AC-10)
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

  it('calls exchangeRefreshToken and returns token on cache miss (BC-7)', async () => {
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

  it('populates cache with expiresAtMs = Date.now() + (expiresIn - 300) * 1000 (BC-7, AC-10)', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    mockRefresh.mockResolvedValue({
      accessToken: 'refresh-cached-token',
      expiresIn: 3600,
    });

    const cache = createTokenCache();
    const ctx = createRuntimeContext();

    await resolveToken(OAUTH_REFRESH_AUTH, ctx, cache, SCOPES, SIGNAL);

    expect(cache.slots.get(SLOT_KEY)).toBeDefined();
    expect(cache.slots.get(SLOT_KEY)!.accessToken).toBe('refresh-cached-token');
    expect(cache.slots.get(SLOT_KEY)!.expiresAtMs).toBe(
      now + (3600 - 300) * 1000
    );
  });

  it('returns cached token on cache hit without calling exchange (BC-6)', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    const futureExpiry = now + 1000;
    const cache: TokenCache = {
      slots: new Map([
        [
          SLOT_KEY,
          { accessToken: 'refresh-hit-token', expiresAtMs: futureExpiry },
        ],
      ]),
    };
    const ctx = createRuntimeContext();

    const result = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('refresh-hit-token');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not use expired cache: re-exchanges when expiresAtMs <= Date.now() (BC-6)', async () => {
    vi.useFakeTimers();
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);

    // Slot with expiresAtMs exactly equal to now — not strictly greater, so expired
    const cache: TokenCache = {
      slots: new Map([
        [SLOT_KEY, { accessToken: 'stale-refresh-token', expiresAtMs: now }],
      ]),
    };
    const ctx = createRuntimeContext();

    mockRefresh.mockResolvedValue({
      accessToken: 'new-refresh-token',
      expiresIn: 3600,
    });

    const result = await resolveToken(
      OAUTH_REFRESH_AUTH,
      ctx,
      cache,
      SCOPES,
      SIGNAL
    );

    expect(result).toBe('new-refresh-token');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
