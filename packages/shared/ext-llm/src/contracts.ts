import type { ApplicationCallable } from '@rcrsr/rill';

export type LlmExtensionContract = {
  readonly message: ApplicationCallable;
  readonly messages: ApplicationCallable;
  readonly embed: ApplicationCallable;
  readonly embed_batch: ApplicationCallable;
  readonly tool_loop: ApplicationCallable;
  readonly generate: ApplicationCallable;
};
