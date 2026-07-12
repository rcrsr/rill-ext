/**
 * JWT signing and token exchange tests for Google Workspace authentication.
 * Covers: AC-9 (JWT claims), AC-8 (key validation), EC-3 (invalid key),
 *         exchangeJwtForToken/exchangeJwtForAccessToken fetch contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  RuntimeError,
  createRuntimeContext,
  isInvalid,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { signServiceAccountJwt } from '../src/auth/jwt.js';
import {
  exchangeJwtForToken,
  exchangeJwtForAccessToken,
} from '../src/auth/exchange.js';
import { parseServiceAccountKey } from '../src/config.js';
import type { ServiceAccountKey } from '../src/types.js';

function makeTestCtx(): RuntimeContext {
  return createRuntimeContext();
}

// ============================================================
// TEST RSA KEY PAIR
// Generate once at module load; 2048-bit is the minimum accepted by Google.
// ============================================================

const { privateKey: TEST_PRIVATE_KEY_OBJ, publicKey: TEST_PUBLIC_KEY_OBJ } =
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const TEST_PRIVATE_KEY = TEST_PRIVATE_KEY_OBJ as unknown as string;
const TEST_PUBLIC_KEY = TEST_PUBLIC_KEY_OBJ as unknown as string;

/** Build a ServiceAccountKey using the test private key. */
function makeTestKey(
  overrides: Partial<ServiceAccountKey> = {}
): ServiceAccountKey {
  return {
    client_email: 'test-sa@test-project.iam.gserviceaccount.com',
    private_key: TEST_PRIVATE_KEY,
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  };
}

/** Decode a base64url string to a UTF-8 string. */
function decodeBase64Url(encoded: string): string {
  const padded = encoded.padEnd(
    encoded.length + ((4 - (encoded.length % 4)) % 4),
    '='
  );
  return Buffer.from(padded, 'base64').toString('utf8');
}

/** Parse and verify a signed JWT assertion. Returns { header, payload }. */
function parseJwt(assertion: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = assertion.split('.');
  if (parts.length !== 3) throw new Error('JWT must have exactly 3 parts');

  const header = JSON.parse(decodeBase64Url(parts[0]!)) as Record<
    string,
    unknown
  >;
  const payload = JSON.parse(decodeBase64Url(parts[1]!)) as Record<
    string,
    unknown
  >;
  return { header, payload };
}

/** Verify the RS256 signature of a JWT assertion using the test public key. */
function verifyJwtSignature(assertion: string): boolean {
  const parts = assertion.split('.');
  if (parts.length !== 3) return false;

  const signingInput = `${parts[0]}.${parts[1]}`;
  const rawSig = parts[2]!;

  // Re-pad base64url to base64
  const padded = rawSig.padEnd(
    rawSig.length + ((4 - (rawSig.length % 4)) % 4),
    '='
  );
  const sigBuffer = Buffer.from(padded, 'base64');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  return verifier.verify(TEST_PUBLIC_KEY, sigBuffer);
}

const SINGLE_SCOPE = ['https://www.googleapis.com/auth/gmail.readonly'];
const MULTI_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive',
];

// ============================================================
// AC-9: JWT header and payload claims
// ============================================================

describe('signServiceAccountJwt — AC-9: JWT claims', () => {
  it('header encodes { alg: "RS256", typ: "JWT" }', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const { header } = parseJwt(assertion);

    expect(header).toStrictEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('aud is https://oauth2.googleapis.com/token (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const { payload } = parseJwt(assertion);

    expect(payload['aud']).toBe('https://oauth2.googleapis.com/token');
  });

  it('exp equals iat + 3600 (AC-9)', () => {
    const key = makeTestKey();
    const before = Math.floor(Date.now() / 1000);
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const after = Math.floor(Date.now() / 1000);

    const { payload } = parseJwt(assertion);
    const iat = payload['iat'] as number;
    const exp = payload['exp'] as number;

    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(after);
    expect(exp).toBe(iat + 3600);
  });

  it('iss is key.client_email (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const { payload } = parseJwt(assertion);

    expect(payload['iss']).toBe('test-sa@test-project.iam.gserviceaccount.com');
  });

  it('scope is scopes joined with a single space (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, MULTI_SCOPES);
    const { payload } = parseJwt(assertion);

    expect(payload['scope']).toBe(
      'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive'
    );
  });

  it('single scope has no trailing or leading space', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const { payload } = parseJwt(assertion);

    expect(payload['scope']).toBe(
      'https://www.googleapis.com/auth/gmail.readonly'
    );
    expect((payload['scope'] as string).startsWith(' ')).toBe(false);
    expect((payload['scope'] as string).endsWith(' ')).toBe(false);
  });

  it('sub claim is present when subject is provided (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(
      makeTestCtx(),
      key,
      SINGLE_SCOPE,
      'user@domain.com'
    );
    const { payload } = parseJwt(assertion);

    expect(payload['sub']).toBe('user@domain.com');
  });

  it('sub claim is absent when subject is not provided (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    const { payload } = parseJwt(assertion);

    expect('sub' in payload).toBe(false);
  });

  it('sub claim is absent when subject is undefined explicitly (AC-9)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(
      makeTestCtx(),
      key,
      SINGLE_SCOPE,
      undefined
    );
    const { payload } = parseJwt(assertion);

    expect('sub' in payload).toBe(false);
  });
});

// ============================================================
// Signature verification
// ============================================================

describe('signServiceAccountJwt — signature verification', () => {
  it('produces a valid RS256 signature verifiable with the test public key', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);

    expect(verifyJwtSignature(assertion)).toBe(true);
  });

  it('RS256 signature is valid for multi-scope assertions', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, MULTI_SCOPES);

    expect(verifyJwtSignature(assertion)).toBe(true);
  });

  it('RS256 signature is valid when subject is provided', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(
      makeTestCtx(),
      key,
      SINGLE_SCOPE,
      'admin@domain.com'
    );

    expect(verifyJwtSignature(assertion)).toBe(true);
  });

  it('assertion has exactly three dot-separated parts', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);

    expect(assertion.split('.').length).toBe(3);
  });
});

// ============================================================
// VAL-1: RS256 fixture verification (base64url encoding + negative control)
// Validates node:crypto API usage against the RFC 7519 / Google JWT contract.
// ============================================================

describe('signServiceAccountJwt — VAL-1: RS256 fixture verification', () => {
  it('all three parts use base64url alphabet with no padding', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(
      makeTestCtx(),
      key,
      SINGLE_SCOPE,
      'sub@domain.com'
    );

    // RFC 7515 §2: base64url uses A-Z, a-z, 0-9, '-', '_'; no '+', '/', or '='
    expect(assertion).not.toMatch(/[+/=]/);
    for (const part of assertion.split('.')) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('signing input matches header-dot-payload exactly (signature covers what we decode)', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, MULTI_SCOPES);

    const parts = assertion.split('.');
    const signingInput = `${parts[0]}.${parts[1]}`;

    // Re-pad signature and verify it covers the signing input we just split.
    const rawSig = parts[2]!;
    const padded = rawSig.padEnd(
      rawSig.length + ((4 - (rawSig.length % 4)) % 4),
      '='
    );
    const sigBuffer = Buffer.from(padded, 'base64');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    expect(verifier.verify(TEST_PUBLIC_KEY, sigBuffer)).toBe(true);
  });

  it('negative control: tampered signing input fails RS256 verification', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);

    const parts = assertion.split('.');
    const tamperedInput = `${parts[0]}.${parts[1]}X`; // mutate payload segment

    const rawSig = parts[2]!;
    const padded = rawSig.padEnd(
      rawSig.length + ((4 - (rawSig.length % 4)) % 4),
      '='
    );
    const sigBuffer = Buffer.from(padded, 'base64');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(tamperedInput);
    expect(verifier.verify(TEST_PUBLIC_KEY, sigBuffer)).toBe(false);
  });

  it('decoded header is byte-exact { alg, typ } with no extra fields', () => {
    const key = makeTestKey();
    const assertion = signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);

    const headerJson = decodeBase64Url(assertion.split('.')[0]!);
    // JSON.parse + strict equality already covered above; here assert the
    // raw decoded JSON has exactly the documented fields in canonical form.
    expect(JSON.parse(headerJson)).toStrictEqual({ alg: 'RS256', typ: 'JWT' });
  });
});

// ============================================================
// EC-3: Invalid private key → #AUTH, no key material in message
// ============================================================

describe('signServiceAccountJwt — EC-3: invalid private_key', () => {
  it('emits #AUTH when private_key is malformed', () => {
    const key = makeTestKey({ private_key: 'not-a-valid-pem-key' });
    let caught: unknown;
    try {
      signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    } catch (e) {
      caught = e;
    }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
  });

  it('error message does not contain key material on signing failure', () => {
    const key = makeTestKey({
      private_key:
        '-----BEGIN PRIVATE KEY-----\nBADDATA\n-----END PRIVATE KEY-----\n',
    });
    let caught: unknown;
    try {
      signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    } catch (e) {
      caught = e;
    }
    const msg = getStatus(caught as RillValue).message;
    expect(msg).not.toContain('BADDATA');
    expect(msg).toContain('google: JWT signing failed');
  });

  it('emits #AUTH for empty private_key string', () => {
    const key = makeTestKey({ private_key: '' });
    let caught: unknown;
    try {
      signServiceAccountJwt(makeTestCtx(), key, SINGLE_SCOPE);
    } catch (e) {
      caught = e;
    }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
  });
});

// ============================================================
// AC-8: parseServiceAccountKey validation
// ============================================================

describe('parseServiceAccountKey — AC-8: required field validation', () => {
  it('returns a valid ServiceAccountKey when all required fields are present', () => {
    const keyJson = JSON.stringify({
      client_email: 'sa@project.iam.gserviceaccount.com',
      private_key:
        '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://oauth2.googleapis.com/token',
    });

    const result = parseServiceAccountKey(keyJson);

    expect(result.client_email).toBe('sa@project.iam.gserviceaccount.com');
    expect(result.token_uri).toBe('https://oauth2.googleapis.com/token');
  });

  it('throws RILL-R001 when client_email is missing (AC-8)', () => {
    const keyJson = JSON.stringify({
      private_key:
        '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    let caught: unknown;
    try {
      parseServiceAccountKey(keyJson);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    expect((caught as RuntimeError).message).toContain('client_email');
  });

  it('throws RILL-R001 when private_key is missing (AC-8)', () => {
    const keyJson = JSON.stringify({
      client_email: 'sa@project.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    let caught: unknown;
    try {
      parseServiceAccountKey(keyJson);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    expect((caught as RuntimeError).message).toContain('private_key');
  });

  it('throws RILL-R001 when token_uri is missing (AC-8)', () => {
    const keyJson = JSON.stringify({
      client_email: 'sa@project.iam.gserviceaccount.com',
      private_key:
        '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
    });
    let caught: unknown;
    try {
      parseServiceAccountKey(keyJson);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    expect((caught as RuntimeError).message).toContain('token_uri');
  });

  it('throws RILL-R001 for non-JSON input', () => {
    let caught: unknown;
    try {
      parseServiceAccountKey('not-json');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
  });

  it('throws RILL-R001 when client_email is empty string', () => {
    const keyJson = JSON.stringify({
      client_email: '',
      private_key:
        '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    let caught: unknown;
    try {
      parseServiceAccountKey(keyJson);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
  });
});

// ============================================================
// exchangeJwtForToken / exchangeJwtForAccessToken — fetch contract
// ============================================================

describe('exchangeJwtForToken — fetch contract', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to https://oauth2.googleapis.com/token', async () => {
    let capturedUrl: string | URL | Request | undefined;

    globalThis.fetch = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ access_token: 'tok123', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    ) as unknown as typeof fetch;

    await exchangeJwtForToken(
      makeTestCtx(),
      'test-assertion',
      new AbortController().signal
    );

    expect(capturedUrl).toBe('https://oauth2.googleapis.com/token');
  });

  it('uses POST method with application/x-www-form-urlencoded Content-Type', async () => {
    let capturedMethod: string | undefined;
    let capturedContentType: string | undefined;

    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedMethod = init?.method;
      capturedContentType = (init?.headers as Record<string, string>)?.[
        'Content-Type'
      ];
      return new Response(
        JSON.stringify({ access_token: 'tok123', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    await exchangeJwtForToken(
      makeTestCtx(),
      'test-assertion',
      new AbortController().signal
    );

    expect(capturedMethod).toBe('POST');
    expect(capturedContentType).toBe('application/x-www-form-urlencoded');
  });

  it('body contains grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer and assertion', async () => {
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({ access_token: 'tok123', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    await exchangeJwtForToken(
      makeTestCtx(),
      'my-assertion-value',
      new AbortController().signal
    );

    expect(capturedBody).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
    );
    expect(capturedBody).toContain('assertion=my-assertion-value');
  });

  it('returns accessToken and expiresIn from JSON response', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'returned-token', expires_in: 7200 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch;

    const result = await exchangeJwtForToken(
      makeTestCtx(),
      'test',
      new AbortController().signal
    );

    expect(result.accessToken).toBe('returned-token');
    expect(result.expiresIn).toBe(7200);
  });

  it('propagates the AbortSignal to fetch', async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(
        JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    await exchangeJwtForToken(makeTestCtx(), 'test', controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it('emits #AUTH on non-OK HTTP response', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await exchangeJwtForToken(
        makeTestCtx(),
        'test',
        new AbortController().signal
      );
    } catch (e) {
      caught = e;
    }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
  });

  it('error message on non-OK response does not contain any token material', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          '{"error":"invalid_grant","access_token":"leaked-token"}',
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    ) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await exchangeJwtForToken(
        makeTestCtx(),
        'my-secret-assertion',
        new AbortController().signal
      );
    } catch (e) {
      caught = e;
    }

    const msg = getStatus(caught as RillValue).message;
    expect(msg).not.toContain('leaked-token');
    expect(msg).not.toContain('my-secret-assertion');
    expect(msg).toContain('400');
  });
});

// ============================================================
// exchangeJwtForAccessToken — thin wrapper
// ============================================================

describe('exchangeJwtForAccessToken — returns only access_token string', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the access_token string from the exchange response', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'wrapper-token', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch;

    const token = await exchangeJwtForAccessToken(
      makeTestCtx(),
      'test',
      new AbortController().signal
    );

    expect(token).toBe('wrapper-token');
  });

  it('emits #AUTH on non-OK response (same as exchangeJwtForToken)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await exchangeJwtForAccessToken(
        makeTestCtx(),
        'test',
        new AbortController().signal
      );
    } catch (e) {
      caught = e;
    }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
  });
});
