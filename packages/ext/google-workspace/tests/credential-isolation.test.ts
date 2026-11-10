import { describeCredentialIsolation } from '@rcrsr/rill-ext-auth-shared/isolation-suite';
import { createGoogleWorkspaceExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_helpers.js';

describeCredentialIsolation('google-workspace', {
  createExtension: (tokenKey) =>
    createGoogleWorkspaceExtension(
      {
        auth: { type: 'session', tokenVar: tokenKey },
        capabilities: { gmail: { search: true } },
      },
      makeFactoryCtx()
    ),
  call: { name: 'gmail_search', args: { query: 'x' } },
  okBody: { messages: [] },
});
