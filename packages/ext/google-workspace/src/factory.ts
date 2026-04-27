/**
 * Extension factory for Google Workspace (Gmail, Drive, Calendar) integration.
 * Validates config, builds disposal and in-flight state, and returns
 * 17 named host function callables and a dispose function.
 *
 * Host functions cover:
 *   Gmail (7):    gmail_search, gmail_read, gmail_send, gmail_draft,
 *                 gmail_reply, gmail_flag, gmail_label
 *   Drive (6):    drive_list, drive_upload, drive_download, drive_share,
 *                 drive_delete, drive_get_metadata
 *   Calendar (4): calendar_events, calendar_today, calendar_create_event,
 *                 calendar_free_busy
 *
 * All operations check disposal and capability before making API calls.
 * Events emit on success per AC-13. Errors map through mapFetchError.
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
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import { validateConfig, mergeCapabilities } from './config.js';
import { checkCapability } from './capabilities.js';
import { mapFetchError } from './errors.js';
import { createTokenCache, clearTokenCache } from './auth/resolve.js';
import type {
  GoogleWorkspaceConfig,
  GoogleAuth,
  GmailConfig,
  DriveConfig,
  CalendarConfig,
  GoogleWorkspaceExtensionContract,
} from './types.js';
import { makeGmailSearch } from './functions/gmail/search.js';
import { makeGmailRead } from './functions/gmail/read.js';
import { makeGmailSend } from './functions/gmail/send.js';
import { makeGmailDraft } from './functions/gmail/draft.js';
import { makeGmailReply } from './functions/gmail/reply.js';
import { makeGmailFlag } from './functions/gmail/flag.js';
import { makeGmailLabel } from './functions/gmail/label.js';
import { makeDriveList } from './functions/drive/list.js';
import { makeDriveUpload } from './functions/drive/upload.js';
import { makeDriveDownload } from './functions/drive/download.js';
import { makeDriveShare } from './functions/drive/share.js';
import { makeDriveDelete } from './functions/drive/delete.js';
import { makeDriveGetMetadata } from './functions/drive/get-metadata.js';
import { makeCalendarEvents } from './functions/calendar/events.js';
import { makeCalendarToday } from './functions/calendar/today.js';
import { makeCalendarCreateEvent } from './functions/calendar/create-event.js';
import { makeCalendarFreeBusy } from './functions/calendar/free-busy.js';

// ============================================================
// CONSTANTS
// ============================================================

const PROVIDER = 'google-workspace';
const SUBSYSTEM = `extension:${PROVIDER}` as const;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a Google Workspace extension instance.
 * Validates configuration and returns 17 host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with 17 callables and dispose
 * @throws RuntimeError (RILL-R001) for invalid configuration
 *
 * @example
 * ```typescript
 * const ext = createGoogleWorkspaceExtension({
 *   auth: { type: 'bearer', token: process.env.GOOGLE_TOKEN },
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createGoogleWorkspaceExtension(
  config: GoogleWorkspaceConfig,
  _ctx: ExtensionFactoryCtx,
): ExtensionFactoryResult {
  // Validate config — throws RuntimeError(RILL-R001) on failure
  validateConfig(config);

  // Merge capabilities with defaults
  const capabilities = mergeCapabilities(config.capabilities);

  // Resolve config values at factory time (immutable closure)
  const auth: GoogleAuth = config.auth;
  const gmailConfig: GmailConfig | undefined = config.gmail;
  const driveConfig: DriveConfig | undefined = config.drive;
  const calendarConfig: CalendarConfig | undefined = config.calendar;

  // Build per-extension token cache (service-account TTL cache)
  const tokenCache = createTokenCache();

  // Inline disposal state [AC-7]
  const disposalState = { isDisposed: false };

  // Inline in-flight tracking state [AC-5]
  const inFlightState: { controllers: Set<AbortController> } = {
    controllers: new Set(),
  };

  // ============================================================
  // WRAP HELPER
  // ============================================================

  /**
   * Wrap a host function with: disposal check, capability gate,
   * AbortController lifecycle, timing, and event emission.
   *
   * @param _fnName - Host function name (reserved for diagnostics)
   * @param service - Google service identifier for event name
   * @param operation - Operation name for event name (e.g. 'search', 'send')
   * @param capabilityCheck - Throws RILL-R004 when capability disabled; null = no gate
   * @param fn - Inner function (args, ctx, controller) => RillValue
   */
  function wrap(
    _fnName: string,
    service: 'gmail' | 'drive' | 'calendar',
    operation: string,
    capabilityCheck: ((ctx: RuntimeContext) => void) | null,
    fn: (
      args: Record<string, RillValue>,
      ctx: RuntimeContext,
      controller: AbortController,
    ) => Promise<RillValue>,
  ): (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue> {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext,
    ): Promise<RillValue> => {
      const disposed = (): RillValue =>
        ctx.invalidate(new Error('google: operation cancelled'), {
          code: 'DISPOSED',
          provider: PROVIDER,
          raw: { kind: 'disposed', message: 'google: operation cancelled' },
        });

      if (disposalState.isDisposed) {
        return disposed();
      }

      if (capabilityCheck !== null) {
        try {
          capabilityCheck(ctx);
        } catch (error: unknown) {
          if (isInvalid(error as RillValue)) {
            return error as RillValue;
          }
          return mapFetchError(ctx, error, service);
        }
      }

      const controller = new AbortController();
      inFlightState.controllers.add(controller);

      const startTime = Date.now();

      try {
        const result = await fn(args, ctx, controller);

        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx, {
          event: `google:${service}:${operation}`,
          subsystem: SUBSYSTEM,
          duration,
        });

        return result;
      } catch (error: unknown) {
        if (disposalState.isDisposed) {
          const invalid = disposed();
          emitExtensionEvent(ctx, {
            event: `google:${service}:error`,
            subsystem: SUBSYSTEM,
            duration: Date.now() - startTime,
            error: getStatus(invalid).message,
          });
          return invalid;
        }
        const invalid = isInvalid(error as RillValue)
          ? (error as RillValue)
          : mapFetchError(ctx, error, service);
        emitExtensionEvent(ctx, {
          event: `google:${service}:error`,
          subsystem: SUBSYSTEM,
          duration: Date.now() - startTime,
          error: getStatus(invalid).message,
        });
        return invalid;
      } finally {
        inFlightState.controllers.delete(controller);
      }
    };
  }

  // ============================================================
  // DISPOSE  [AC-7, AC-5, AC-10]
  // ============================================================

  /**
   * Abort all in-flight requests and mark extension as disposed.
   * Idempotent: second call returns immediately without side effects. [AC-7]
   */
  const disposeExtension = async (): Promise<void> => {
    // AC-7: Idempotent guard
    if (disposalState.isDisposed) {
      return;
    }

    // Set disposed first so new calls fail immediately [BC-5]
    disposalState.isDisposed = true;

    // AC-5: Abort all tracked in-flight requests
    for (const controller of inFlightState.controllers) {
      controller.abort();
    }
    inFlightState.controllers.clear();

    // AC-10: Clear service-account token cache
    clearTokenCache(tokenCache);
  };

  // ============================================================
  // GMAIL HOST FUNCTIONS
  // ============================================================

  const gmailSearchWrapped = wrap(
    'gmail_search',
    'gmail',
    'search',
    (c) => checkCapability(c, capabilities.gmail.search, 'gmail.search'),
    makeGmailSearch({ auth, cache: tokenCache, gmailConfig })
  );

  const gmailReadWrapped = wrap(
    'gmail_read',
    'gmail',
    'read',
    (c) => checkCapability(c, capabilities.gmail.read, 'gmail.read'),
    makeGmailRead({ auth, cache: tokenCache })
  );

  const gmailSendWrapped = wrap(
    'gmail_send',
    'gmail',
    'send',
    (c) => checkCapability(c, capabilities.gmail.send, 'gmail.send'),
    makeGmailSend({ auth, cache: tokenCache })
  );

  const gmailDraftWrapped = wrap(
    'gmail_draft',
    'gmail',
    'draft',
    (c) => checkCapability(c, capabilities.gmail.draft, 'gmail.draft'),
    makeGmailDraft({ auth, cache: tokenCache })
  );

  const gmailReplyWrapped = wrap(
    'gmail_reply',
    'gmail',
    'reply',
    (c) => checkCapability(c, capabilities.gmail.reply, 'gmail.reply'),
    makeGmailReply({ auth, cache: tokenCache })
  );

  const gmailFlagWrapped = wrap(
    'gmail_flag',
    'gmail',
    'flag',
    (c) => checkCapability(c, capabilities.gmail.modify, 'gmail.modify'),
    makeGmailFlag({ auth, cache: tokenCache })
  );

  const gmailLabelWrapped = wrap(
    'gmail_label',
    'gmail',
    'label',
    (c) => checkCapability(c, capabilities.gmail.label, 'gmail.label'),
    makeGmailLabel({ auth, cache: tokenCache, gmailConfig })
  );

  // ============================================================
  // DRIVE HOST FUNCTIONS
  // ============================================================

  const driveListWrapped = wrap(
    'drive_list',
    'drive',
    'list',
    (c) => checkCapability(c, capabilities.drive.list, 'drive.list'),
    makeDriveList({ auth, cache: tokenCache, driveConfig })
  );

  const driveUploadWrapped = wrap(
    'drive_upload',
    'drive',
    'upload',
    (c) => checkCapability(c, capabilities.drive.upload, 'drive.upload'),
    makeDriveUpload({ auth, cache: tokenCache, driveConfig })
  );

  const driveDownloadWrapped = wrap(
    'drive_download',
    'drive',
    'download',
    (c) => checkCapability(c, capabilities.drive.download, 'drive.download'),
    makeDriveDownload({ auth, cache: tokenCache })
  );

  const driveShareWrapped = wrap(
    'drive_share',
    'drive',
    'share',
    (c) => checkCapability(c, capabilities.drive.share, 'drive.share'),
    makeDriveShare({ auth, cache: tokenCache })
  );

  const driveDeleteWrapped = wrap(
    'drive_delete',
    'drive',
    'delete',
    (c) => checkCapability(c, capabilities.drive.delete, 'drive.delete'),
    makeDriveDelete({ auth, cache: tokenCache })
  );

  const driveGetMetadataWrapped = wrap(
    'drive_get_metadata',
    'drive',
    'get_metadata',
    (c) => checkCapability(c, capabilities.drive.read, 'drive.read'),
    makeDriveGetMetadata({ auth, cache: tokenCache })
  );

  // ============================================================
  // CALENDAR HOST FUNCTIONS
  // ============================================================

  const calendarEventsWrapped = wrap(
    'calendar_events',
    'calendar',
    'events',
    (c) => checkCapability(c, capabilities.calendar.read, 'calendar.read'),
    makeCalendarEvents({ auth, cache: tokenCache, calendarConfig })
  );

  const calendarTodayWrapped = wrap(
    'calendar_today',
    'calendar',
    'today',
    (c) => checkCapability(c, capabilities.calendar.read, 'calendar.read'),
    makeCalendarToday({ auth, cache: tokenCache, calendarConfig })
  );

  const calendarCreateEventWrapped = wrap(
    'calendar_create_event',
    'calendar',
    'create_event',
    (c) => checkCapability(c, capabilities.calendar.create, 'calendar.create'),
    makeCalendarCreateEvent({ auth, cache: tokenCache, calendarConfig })
  );

  const calendarFreeBusyWrapped = wrap(
    'calendar_free_busy',
    'calendar',
    'free_busy',
    (c) => checkCapability(c, capabilities.calendar.freeBusy, 'calendar.freeBusy'),
    makeCalendarFreeBusy({ auth, cache: tokenCache })
  );

  // ============================================================
  // CALLABLE DICT  [AC-1]
  // ============================================================

  const dictReturnType = structureToTypeValue({ kind: 'dict' });
  const stringReturnType = structureToTypeValue({ kind: 'string' });
  const boolReturnType = structureToTypeValue({ kind: 'bool' });

  const callableDict = {
    // Gmail (7)
    gmail_search: toCallable({
      fn: gmailSearchWrapped as CallableFn,
      params: [
        p.str('query'),
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
    gmail_read: toCallable({
      fn: gmailReadWrapped as CallableFn,
      params: [p.str('messageId')],
      returnType: dictReturnType,
    }),
    gmail_send: toCallable({
      fn: gmailSendWrapped as CallableFn,
      params: [
        p.str('to'),
        p.str('subject'),
        p.str('body'),
        p.dict('options', undefined, {}),
      ],
      returnType: stringReturnType,
    }),
    gmail_draft: toCallable({
      fn: gmailDraftWrapped as CallableFn,
      params: [
        p.str('to'),
        p.str('subject'),
        p.str('body'),
        p.dict('options', undefined, {}),
      ],
      returnType: stringReturnType,
    }),
    gmail_reply: toCallable({
      fn: gmailReplyWrapped as CallableFn,
      params: [
        p.str('messageId'),
        p.str('body'),
        p.dict('options', undefined, {}),
      ],
      returnType: stringReturnType,
    }),
    gmail_flag: toCallable({
      fn: gmailFlagWrapped as CallableFn,
      params: [p.str('messageId'), p.bool('flagged')],
      returnType: boolReturnType,
    }),
    gmail_label: toCallable({
      fn: gmailLabelWrapped as CallableFn,
      params: [p.str('messageId'), p.str('labelName')],
      returnType: boolReturnType,
    }),
    // Drive (6)
    drive_list: toCallable({
      fn: driveListWrapped as CallableFn,
      params: [
        p.str('folderId'),
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
    drive_upload: toCallable({
      fn: driveUploadWrapped as CallableFn,
      params: [
        p.str('content'),
        p.str('filename'),
        p.str('folderId'),
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
    drive_download: toCallable({
      fn: driveDownloadWrapped as CallableFn,
      params: [p.str('fileId')],
      returnType: stringReturnType,
    }),
    drive_share: toCallable({
      fn: driveShareWrapped as CallableFn,
      params: [
        p.str('fileId'),
        p.str('email'),
        p.str('role'),
      ],
      returnType: boolReturnType,
    }),
    drive_delete: toCallable({
      fn: driveDeleteWrapped as CallableFn,
      params: [p.str('fileId')],
      returnType: boolReturnType,
    }),
    drive_get_metadata: toCallable({
      fn: driveGetMetadataWrapped as CallableFn,
      params: [p.str('fileId')],
      returnType: dictReturnType,
    }),
    // Calendar (4)
    calendar_events: toCallable({
      fn: calendarEventsWrapped as CallableFn,
      params: [
        p.str('startDate'),
        p.str('endDate'),
        p.dict('options', undefined, {}),
      ],
      returnType: dictReturnType,
    }),
    calendar_today: toCallable({
      fn: calendarTodayWrapped as CallableFn,
      params: [p.dict('options', undefined, {})],
      returnType: dictReturnType,
    }),
    calendar_create_event: toCallable({
      fn: calendarCreateEventWrapped as CallableFn,
      params: [
        p.str('title'),
        p.str('startTime'),
        p.str('endTime'),
        p.dict('options', undefined, {}),
      ],
      returnType: stringReturnType,
    }),
    calendar_free_busy: toCallable({
      fn: calendarFreeBusyWrapped as CallableFn,
      params: [
        p.list('emails', { kind: 'string' }),
        p.str('startTime'),
        p.str('endTime'),
      ],
      returnType: dictReturnType,
    }),
  } satisfies GoogleWorkspaceExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose: disposeExtension,
  } satisfies ExtensionFactoryResult;
}
