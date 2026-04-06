/**
 * search host function — full-text search messages using Graph $search.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Search messages using the Graph API $search parameter.
 * Caps `top` at config.maxResults.
 *
 * @throws RuntimeError (RILL-R004) when query is empty
 */
export async function search(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const query = (args['query'] as string | undefined) ?? '';

  if (query.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: query is required');
  }

  const rawTop = args['top'] as number | undefined;
  const top = Math.min(
    rawTop !== undefined && rawTop > 0 ? Math.floor(rawTop) : config.maxResults,
    config.maxResults
  );

  // $search uses double-quoted value per Graph API spec
  const path = `messages?$search="${query}"&$top=${top}`;

  const response = await graphFetch(
    'GET',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller
  );

  const data = response as { value?: unknown[] };
  const messages = (data.value ?? []).map(normalizeMessage);

  return { messages, query } as unknown as RillValue;
}
