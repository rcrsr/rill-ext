/**
 * Extension factory for Outlook (Microsoft Graph API) integration.
 * Validates config, builds disposal and in-flight state, and returns
 * 12 named host function callables and a dispose function.
 *
 * Host functions cover:
 *   Mail: inbox, from, search, read, send, draft, reply, flag
 *   Calendar: events, today, free_busy, create_event
 *
 * All operations check disposal and capability before making API calls.
 * Events emit on success per §IR-8. Errors map through mapFetchError.
 */

import {
  RuntimeError,
  toCallable,
  structureToTypeValue,
  emitExtensionEvent,
  type CallableFn,
  type ExtensionFactoryResult,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import {
  validateConfig,
  mergeCapabilities,
  DEFAULT_MAX_RESULTS,
  DEFAULT_FOLDERS,
} from './config.js';
import { checkCapability } from './capabilities.js';
import { mapFetchError } from './errors.js';
import type {
  OutlookAuth,
  OutlookConfig,
  OutlookCapabilities,
  OutlookExtensionContract,
} from './types.js';

import { inbox } from './functions/inbox.js';
import { from as fromFn } from './functions/from.js';
import { search } from './functions/search.js';
import { read } from './functions/read.js';
import { send } from './functions/send.js';
import { draft } from './functions/draft.js';
import { reply } from './functions/reply.js';
import { flag } from './functions/flag.js';
import { events } from './functions/events.js';
import { today } from './functions/today.js';
import { freeBusy } from './functions/free-busy.js';
import { createEvent } from './functions/create-event.js';

// ============================================================
// INTERNAL TYPES
// ============================================================

/**
 * Resolved configuration state passed to each host function.
 * Captured at factory time; immutable for the extension lifetime.
 */
export interface ResolvedConfig {
  readonly auth: OutlookAuth;
  readonly mailbox: string | undefined;
  readonly capabilities: OutlookCapabilities;
  readonly maxResults: number;
  readonly folders: readonly string[];
}

// ============================================================
// CONSTANTS
// ============================================================

const PROVIDER = 'outlook';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create an Outlook extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with 12 callables and dispose
 * @throws RuntimeError (RILL-R004) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createOutlookExtension({
 *   auth: { type: 'bearer', token: process.env.OUTLOOK_TOKEN },
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createOutlookExtension(config: OutlookConfig): ExtensionFactoryResult {
  // Validate config — throws RILL-R004 on failure
  validateConfig(config);

  // Merge capabilities with defaults [AC-15]
  const capabilities = mergeCapabilities(config.capabilities);

  // Resolve config values at factory time (immutable closure)
  const resolvedConfig: ResolvedConfig = {
    auth: config.auth,
    mailbox: config.mailbox,
    capabilities,
    maxResults: config.mail?.maxResults ?? DEFAULT_MAX_RESULTS,
    folders: config.mail?.folders ?? DEFAULT_FOLDERS,
  };

  // Inline disposal state [IR-6]
  const disposalState = { isDisposed: false };

  // Inline in-flight tracking state
  const inFlightState: { controllers: Set<AbortController> } = {
    controllers: new Set(),
  };

  // ============================================================
  // WRAP HELPER
  // ============================================================

  /**
   * Wrap a host function with: disposal check, capability gate,
   * AbortController lifecycle, timing, event emission, and error mapping.
   *
   * @param capabilityCheck - Throws RILL-R004 when capability disabled; null = no gate
   * @param eventFactory - Builds success event fields from the result
   * @param fn - Inner function (args, ctx, controller, config) => RillValue
   */
  function wrap(
    capabilityCheck: (() => void) | null,
    eventFactory: (result: RillValue) => Record<string, RillValue>,
    fn: (
      args: Record<string, RillValue>,
      ctx: RuntimeContext,
      controller: AbortController,
      cfg: ResolvedConfig
    ) => Promise<RillValue>
  ): (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue> {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      // EC-13: Check disposal before any work
      if (disposalState.isDisposed) {
        throw new RuntimeError('RILL-R004', `${PROVIDER}: operation cancelled`);
      }

      // Capability gate (if provided)
      if (capabilityCheck !== null) {
        capabilityCheck();
      }

      // Create and track AbortController
      const controller = new AbortController();
      inFlightState.controllers.add(controller);

      // Record wall-clock start
      const startTime = Date.now();

      try {
        const result = await fn(args, ctx, controller, resolvedConfig);

        // IR-8: Emit named success event
        const duration = Date.now() - startTime;
        const eventFields = eventFactory(result);
        emitExtensionEvent(ctx, {
          ...eventFields,
          duration,
          subsystem: `extension:${PROVIDER}`,
        });

        return result;
      } catch (error: unknown) {
        // IR-8: Emit error event on any failure
        const duration = Date.now() - startTime;
        const mappedError =
          error instanceof RuntimeError ? error : mapFetchError(error);

        emitExtensionEvent(ctx, {
          event: `${PROVIDER}:error`,
          subsystem: `extension:${PROVIDER}`,
          duration,
          error: mappedError.message,
        });

        throw mappedError;
      } finally {
        // Always remove controller regardless of outcome
        inFlightState.controllers.delete(controller);
      }
    };
  }

  // ============================================================
  // HOST FUNCTIONS  [AC-1, IR-8]
  // ============================================================

  // Mail: inbox — emits outlook:mail:read
  const inboxWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: 'inbox' as RillValue,
        messageCount: (messages?.length ?? 0) as RillValue,
      };
    },
    inbox
  );

  // Mail: from — emits outlook:mail:read
  const fromWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: 'inbox' as RillValue,
        messageCount: (messages?.length ?? 0) as RillValue,
      };
    },
    fromFn
  );

  // Mail: search — emits outlook:mail:search
  const searchWrapped = wrap(
    () => {
      checkCapability(resolvedConfig.capabilities.mail.read, 'mail.read');
      checkCapability(resolvedConfig.capabilities.mail.search, 'mail.search');
    },
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:search`,
        query: (dict['query'] ?? '') as RillValue,
        resultCount: (messages?.length ?? 0) as RillValue,
      };
    },
    search
  );

  // Mail: read — emits outlook:mail:read
  const readWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: (dict['folder'] ?? 'inbox') as RillValue,
        messageCount: 1 as RillValue,
      };
    },
    read
  );

  // Mail: send — emits outlook:mail:send
  const sendWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.send, 'mail.send'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:send`,
        to: (dict['to'] ?? '') as RillValue,
        subject: (dict['subject'] ?? '') as RillValue,
      };
    },
    send
  );

  // Mail: draft — emits outlook:mail:draft
  const draftWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.draft, 'mail.draft'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:draft`,
        to: (dict['to'] ?? '') as RillValue,
        subject: (dict['subject'] ?? '') as RillValue,
      };
    },
    draft
  );

  // Mail: reply — emits outlook:mail:send
  const replyWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.send, 'mail.send'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:send`,
        to: (dict['to'] ?? '') as RillValue,
        subject: (dict['subject'] ?? '') as RillValue,
      };
    },
    reply
  );

  // Mail: flag — emits outlook:mail:flag
  const flagWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.mail.flag, 'mail.flag'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:flag`,
        messageId: (dict['id'] ?? '') as RillValue,
      };
    },
    flag
  );

  // Calendar: events — emits outlook:calendar:read
  const eventsWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.calendar.read, 'calendar.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const eventsArr = dict['events'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        eventCount: (eventsArr?.length ?? 0) as RillValue,
        range: (dict['range'] ?? '') as RillValue,
      };
    },
    events
  );

  // Calendar: today — emits outlook:calendar:read
  const todayWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.calendar.read, 'calendar.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const eventsArr = dict['events'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        eventCount: (eventsArr?.length ?? 0) as RillValue,
        range: 'today' as RillValue,
      };
    },
    today
  );

  // Calendar: free_busy — emits outlook:calendar:read
  const freeBusyWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.calendar.read, 'calendar.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const schedules = dict['schedules'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        eventCount: (schedules?.length ?? 0) as RillValue,
        range: (dict['range'] ?? '') as RillValue,
      };
    },
    freeBusy
  );

  // Calendar: create_event — emits outlook:calendar:create
  const createEventWrapped = wrap(
    () => checkCapability(resolvedConfig.capabilities.calendar.create, 'calendar.create'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:calendar:create`,
        title: (dict['title'] ?? '') as RillValue,
      };
    },
    createEvent
  );

  // ============================================================
  // DISPOSE  [IR-6, AC-20]
  // ============================================================

  /**
   * Abort all in-flight requests and mark extension as disposed.
   * Idempotent: second call returns immediately without side effects.
   */
  const disposeExtension = async (): Promise<void> => {
    if (disposalState.isDisposed) {
      return;
    }

    // Abort all tracked controllers
    for (const controller of inFlightState.controllers) {
      controller.abort();
    }
    inFlightState.controllers.clear();

    // Mark disposed (prevents further operations)
    disposalState.isDisposed = true;
  };

  // ============================================================
  // CALLABLE DICT  [AC-1]
  // ============================================================

  const dictReturnType = structureToTypeValue({ kind: 'dict' });

  const callableDict = {
    inbox: toCallable({
      fn: inboxWrapped as CallableFn,
      params: [p.num('top', undefined, DEFAULT_MAX_RESULTS), p.bool('unread'), p.str('folder')],
      returnType: dictReturnType,
    }),
    from: toCallable({
      fn: fromWrapped as CallableFn,
      params: [p.str('address'), p.num('top', undefined, DEFAULT_MAX_RESULTS)],
      returnType: dictReturnType,
    }),
    search: toCallable({
      fn: searchWrapped as CallableFn,
      params: [p.str('query'), p.num('top', undefined, DEFAULT_MAX_RESULTS)],
      returnType: dictReturnType,
    }),
    read: toCallable({
      fn: readWrapped as CallableFn,
      params: [p.str('messageId')],
      returnType: dictReturnType,
    }),
    send: toCallable({
      fn: sendWrapped as CallableFn,
      params: [p.list('to'), p.str('subject'), p.str('body')],
      returnType: dictReturnType,
    }),
    draft: toCallable({
      fn: draftWrapped as CallableFn,
      params: [p.list('to'), p.str('subject'), p.str('body')],
      returnType: dictReturnType,
    }),
    reply: toCallable({
      fn: replyWrapped as CallableFn,
      params: [p.str('messageId'), p.str('body')],
      returnType: dictReturnType,
    }),
    flag: toCallable({
      fn: flagWrapped as CallableFn,
      params: [p.str('messageId')],
      returnType: dictReturnType,
    }),
    events: toCallable({
      fn: eventsWrapped as CallableFn,
      params: [p.num('start'), p.num('end')],
      returnType: dictReturnType,
    }),
    today: toCallable({
      fn: todayWrapped as CallableFn,
      params: [],
      returnType: dictReturnType,
    }),
    free_busy: toCallable({
      fn: freeBusyWrapped as CallableFn,
      params: [p.num('start'), p.num('end'), p.list('attendees')],
      returnType: dictReturnType,
    }),
    create_event: toCallable({
      fn: createEventWrapped as CallableFn,
      params: [
        p.str('title'),
        p.num('start'),
        p.num('end'),
        p.dict('options'),
      ],
      returnType: dictReturnType,
    }),
  } satisfies OutlookExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
