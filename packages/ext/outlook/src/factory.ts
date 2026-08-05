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
 * Events emit on success. Errors map through mapFetchError.
 */

import {
  toCallable,
  structureToTypeValue,
  emitExtensionEvent,
  isInvalid,
  getStatus,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillValue,
  type RuntimeContext,
  type TypeStructure,
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
 * @throws RuntimeError (RILL-R001) for invalid configuration
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
export function createOutlookExtension(
  config: OutlookConfig,
  _ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Validate config — throws RuntimeError(RILL-R001) on failure
  validateConfig(config);

  // Merge capabilities with defaults
  const capabilities = mergeCapabilities(config.capabilities);

  // Resolve config values at factory time (immutable closure)
  const resolvedConfig: ResolvedConfig = {
    auth: config.auth,
    mailbox: config.mailbox,
    capabilities,
    maxResults: config.mail?.maxResults ?? DEFAULT_MAX_RESULTS,
    folders: config.mail?.folders ?? DEFAULT_FOLDERS,
  };

  // Inline disposal state
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
   * @param capabilityCheck - Halts with invalid `#FORBIDDEN` when capability disabled; null = no gate
   * @param eventFactory - Builds success event fields from the result
   * @param fn - Inner function (args, ctx, controller, config) => RillValue
   */
  function wrap(
    capabilityCheck: ((ctx: RuntimeContext) => void) | null,
    eventFactory: (result: RillValue) => Record<string, RillValue>,
    fn: (
      args: Record<string, RillValue>,
      ctx: RuntimeContext,
      controller: AbortController,
      cfg: ResolvedConfig
    ) => Promise<RillValue>
  ): (
    args: Record<string, RillValue>,
    ctx: RuntimeContext
  ) => Promise<RillValue> {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      const startTime = Date.now();

      const emitError = (message: string): void => {
        emitExtensionEvent(ctx, {
          event: `${PROVIDER}:error`,
          subsystem: `extension:${PROVIDER}`,
          duration: Date.now() - startTime,
          error: message,
        });
      };

      if (disposalState.isDisposed) {
        const message = `${PROVIDER}: operation cancelled`;
        const invalid = ctx.invalidate(new Error(message), {
          code: 'DISPOSED',
          provider: PROVIDER,
          raw: { kind: 'disposed', message },
        });
        emitError(message);
        return invalid;
      }

      if (capabilityCheck !== null) {
        try {
          capabilityCheck(ctx);
        } catch (error: unknown) {
          if (isInvalid(error as RillValue)) {
            const invalid = error as RillValue;
            emitError(getStatus(invalid).message);
            return invalid;
          }
          const invalid = mapFetchError(ctx, error);
          emitError(getStatus(invalid).message);
          return invalid;
        }
      }

      const controller = new AbortController();
      inFlightState.controllers.add(controller);

      try {
        const result = await fn(args, ctx, controller, resolvedConfig);

        const duration = Date.now() - startTime;
        const eventFields = eventFactory(result);
        emitExtensionEvent(ctx, {
          ...eventFields,
          duration,
          subsystem: `extension:${PROVIDER}`,
        });

        return result;
      } catch (error: unknown) {
        const invalid = isInvalid(error as RillValue)
          ? (error as RillValue)
          : mapFetchError(ctx, error);
        emitError(getStatus(invalid).message);
        return invalid;
      } finally {
        inFlightState.controllers.delete(controller);
      }
    };
  }

  // ============================================================
  // HOST FUNCTIONS
  // ============================================================

  // Mail: inbox — emits outlook:mail:read
  const inboxWrapped = wrap(
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: (dict['folder'] ?? 'inbox') as RillValue,
        message_count: (messages?.length ?? 0) as RillValue,
      };
    },
    inbox
  );

  // Mail: from — emits outlook:mail:read
  const fromWrapped = wrap(
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: 'from' as RillValue,
        message_count: (messages?.length ?? 0) as RillValue,
      };
    },
    fromFn
  );

  // Mail: search — emits outlook:mail:search
  const searchWrapped = wrap(
    (c) => {
      checkCapability(c, resolvedConfig.capabilities.mail.read, 'mail.read');
      checkCapability(
        c,
        resolvedConfig.capabilities.mail.search,
        'mail.search'
      );
    },
    (result) => {
      const dict = result as Record<string, RillValue>;
      const messages = dict['messages'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:mail:search`,
        query: (dict['query'] ?? '') as RillValue,
        result_count: (messages?.length ?? 0) as RillValue,
      };
    },
    search
  );

  // Mail: read — emits outlook:mail:read
  const readWrapped = wrap(
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.read, 'mail.read'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:read`,
        folder: (dict['folder'] ?? 'inbox') as RillValue,
        message_count: 1 as RillValue,
      };
    },
    read
  );

  // Mail: send — emits outlook:mail:send
  const sendWrapped = wrap(
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.send, 'mail.send'),
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
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.draft, 'mail.draft'),
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
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.send, 'mail.send'),
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
    (c) =>
      checkCapability(c, resolvedConfig.capabilities.mail.flag, 'mail.flag'),
    (result) => {
      const dict = result as Record<string, RillValue>;
      return {
        event: `${PROVIDER}:mail:flag`,
        message_id: (dict['id'] ?? '') as RillValue,
      };
    },
    flag
  );

  // Calendar: events — emits outlook:calendar:read
  const eventsWrapped = wrap(
    (c) =>
      checkCapability(
        c,
        resolvedConfig.capabilities.calendar.read,
        'calendar.read'
      ),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const eventsArr = dict['events'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        event_count: (eventsArr?.length ?? 0) as RillValue,
        range: (dict['range'] ?? '') as RillValue,
      };
    },
    events
  );

  // Calendar: today — emits outlook:calendar:read
  const todayWrapped = wrap(
    (c) =>
      checkCapability(
        c,
        resolvedConfig.capabilities.calendar.read,
        'calendar.read'
      ),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const eventsArr = dict['events'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        event_count: (eventsArr?.length ?? 0) as RillValue,
        range: 'today' as RillValue,
      };
    },
    today
  );

  // Calendar: free_busy — emits outlook:calendar:read
  const freeBusyWrapped = wrap(
    (c) =>
      checkCapability(
        c,
        resolvedConfig.capabilities.calendar.read,
        'calendar.read'
      ),
    (result) => {
      const dict = result as Record<string, RillValue>;
      const schedules = dict['schedules'] as RillValue[] | undefined;
      return {
        event: `${PROVIDER}:calendar:read`,
        event_count: (schedules?.length ?? 0) as RillValue,
        range: (dict['range'] ?? '') as RillValue,
      };
    },
    freeBusy
  );

  // Calendar: create_event — emits outlook:calendar:create
  const createEventWrapped = wrap(
    (c) =>
      checkCapability(
        c,
        resolvedConfig.capabilities.calendar.create,
        'calendar.create'
      ),
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
  // DISPOSE
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
  // CALLABLE DICT
  // ============================================================

  // Rich return-type shapes per .claude/policies/policy-domain-ext.md §EXT.8.
  // Shared element shapes mirror the normalize.ts dict types: MailMessageDict
  // (9 fields), CalendarEventDict (8 fields), FreeBusyScheduleDict (3 fields).
  const MAIL_MESSAGE_DICT: TypeStructure = {
    kind: 'dict',
    fields: {
      id: { type: { kind: 'string' } },
      subject: { type: { kind: 'string' } },
      preview: { type: { kind: 'string' } },
      from: { type: { kind: 'string' } },
      to: { type: { kind: 'list', element: { kind: 'string' } } },
      date: { type: { kind: 'number' } },
      unread: { type: { kind: 'bool' } },
      flagged: { type: { kind: 'bool' } },
      has_attachments: { type: { kind: 'bool' } },
    },
  };
  const CALENDAR_EVENT_DICT: TypeStructure = {
    kind: 'dict',
    fields: {
      id: { type: { kind: 'string' } },
      title: { type: { kind: 'string' } },
      start: { type: { kind: 'number' } },
      end: { type: { kind: 'number' } },
      location: { type: { kind: 'string' } },
      attendees: { type: { kind: 'list', element: { kind: 'string' } } },
      is_online: { type: { kind: 'bool' } },
      online_url: { type: { kind: 'string' } },
    },
  };
  const FREE_BUSY_SCHEDULE_DICT: TypeStructure = {
    kind: 'dict',
    fields: {
      schedule_id: { type: { kind: 'string' } },
      availability: { type: { kind: 'string' } },
      items: {
        type: {
          kind: 'list',
          element: {
            kind: 'dict',
            fields: {
              status: { type: { kind: 'string' } },
              subject: { type: { kind: 'string' } },
              start: { type: { kind: 'number' } },
              end: { type: { kind: 'number' } },
            },
          },
        },
      },
    },
  };
  const MAIL_MESSAGE_RT = structureToTypeValue(MAIL_MESSAGE_DICT);
  const CALENDAR_EVENT_RT = structureToTypeValue(CALENDAR_EVENT_DICT);
  const INBOX_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      messages: { type: { kind: 'list', element: MAIL_MESSAGE_DICT } },
      folder: { type: { kind: 'string' } },
    },
  });
  const FROM_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      messages: { type: { kind: 'list', element: MAIL_MESSAGE_DICT } },
    },
  });
  const SEARCH_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      messages: { type: { kind: 'list', element: MAIL_MESSAGE_DICT } },
      query: { type: { kind: 'string' } },
    },
  });
  const SEND_REPLY_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      sent: { type: { kind: 'bool' } },
      to: { type: { kind: 'list', element: { kind: 'string' } } },
      subject: { type: { kind: 'string' } },
    },
  });
  const EVENTS_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      events: { type: { kind: 'list', element: CALENDAR_EVENT_DICT } },
      range: { type: { kind: 'string' } },
    },
  });
  const TODAY_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      events: { type: { kind: 'list', element: CALENDAR_EVENT_DICT } },
    },
  });
  const FREE_BUSY_RT = structureToTypeValue({
    kind: 'dict',
    fields: {
      schedules: { type: { kind: 'list', element: FREE_BUSY_SCHEDULE_DICT } },
      range: { type: { kind: 'string' } },
    },
  });

  const callableDict = {
    inbox: toCallable({
      fn: inboxWrapped as CallableFn,
      params: [
        p.num('top', undefined, DEFAULT_MAX_RESULTS),
        p.bool('unread'),
        p.str('folder'),
      ],
      returnType: INBOX_RT,
    }),
    from: toCallable({
      fn: fromWrapped as CallableFn,
      params: [p.str('address'), p.num('top', undefined, DEFAULT_MAX_RESULTS)],
      returnType: FROM_RT,
    }),
    search: toCallable({
      fn: searchWrapped as CallableFn,
      params: [p.str('query'), p.num('top', undefined, DEFAULT_MAX_RESULTS)],
      returnType: SEARCH_RT,
    }),
    read: toCallable({
      fn: readWrapped as CallableFn,
      params: [p.str('message_id')],
      returnType: MAIL_MESSAGE_RT,
    }),
    send: toCallable({
      fn: sendWrapped as CallableFn,
      params: [p.list('to'), p.str('subject'), p.str('body')],
      returnType: SEND_REPLY_RT,
    }),
    draft: toCallable({
      fn: draftWrapped as CallableFn,
      params: [p.list('to'), p.str('subject'), p.str('body')],
      returnType: MAIL_MESSAGE_RT,
    }),
    reply: toCallable({
      fn: replyWrapped as CallableFn,
      params: [p.str('message_id'), p.str('body')],
      returnType: SEND_REPLY_RT,
    }),
    flag: toCallable({
      fn: flagWrapped as CallableFn,
      params: [p.str('message_id')],
      returnType: MAIL_MESSAGE_RT,
    }),
    events: toCallable({
      fn: eventsWrapped as CallableFn,
      params: [p.num('start'), p.num('end')],
      returnType: EVENTS_RT,
    }),
    today: toCallable({
      fn: todayWrapped as CallableFn,
      params: [],
      returnType: TODAY_RT,
    }),
    free_busy: toCallable({
      fn: freeBusyWrapped as CallableFn,
      params: [p.num('start'), p.num('end'), p.list('attendees')],
      returnType: FREE_BUSY_RT,
    }),
    create_event: toCallable({
      fn: createEventWrapped as CallableFn,
      params: [
        p.str('title'),
        p.num('start'),
        p.num('end'),
        p.dict('options', undefined, {}),
      ],
      returnType: CALENDAR_EVENT_RT,
    }),
  } satisfies OutlookExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
