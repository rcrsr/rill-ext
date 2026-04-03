import type { ApplicationCallable } from '@rcrsr/rill';

export type VectorExtensionContract = {
  readonly upsert: ApplicationCallable;
  readonly upsert_batch: ApplicationCallable;
  readonly search: ApplicationCallable;
  readonly get: ApplicationCallable;
  readonly delete: ApplicationCallable;
  readonly delete_batch: ApplicationCallable;
  readonly count: ApplicationCallable;
  readonly create_collection: ApplicationCallable;
  readonly delete_collection: ApplicationCallable;
  readonly list_collections: ApplicationCallable;
  readonly describe: ApplicationCallable;
};
