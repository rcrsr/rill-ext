/**
 * search host function — full-text search messages using Graph $search.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Search messages using the Graph API $search parameter.
 * Caps `top` at config.maxResults.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when query is empty
 */
export async function search(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const query = (args['query'] as string | undefined) ?? '';

  if (query.trim() === '') {
    failInput(ctx, 'missing_query', 'outlook: query is required');
  }

  const rawTop = args['top'] as number | undefined;
  const top = Math.min(
    rawTop !== undefined && rawTop > 0 ? Math.floor(rawTop) : config.maxResults,
    config.maxResults
  );

  // $search uses double-quoted value per Graph API spec; encode the query to
  // handle special characters and spaces safely in the URL.
  const path = `messages?$search="${encodeURIComponent(query)}"&$top=${top}`;

  const response = await graphFetch(
    'GET',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller,
    undefined,
    { ConsistencyLevel: 'eventual' }
  );

  const data = response as { value?: unknown[] };
  const messages = (data.value ?? []).map(normalizeMessage);

  return { messages, query } as unknown as RillValue;
}
