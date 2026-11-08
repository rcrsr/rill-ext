/**
 * Pins the closed-connection message the factory matches against the
 * constant ioredis itself uses when disconnect() rejects pending commands.
 */

import { describe, it, expect } from 'vitest';
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils/index.js';

describe('ioredis closed-connection message', () => {
  it('matches the message the factory classifies as dispose-caused', () => {
    expect(CONNECTION_CLOSED_ERROR_MSG).toBe('Connection is closed.');
  });
});
