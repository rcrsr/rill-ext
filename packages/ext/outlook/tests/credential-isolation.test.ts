import { describeCredentialIsolation } from '@rcrsr/rill-ext-auth-shared/isolation-suite';
import { makeFactoryCtx } from './_helpers.js';
import { createOutlookExtension } from '../src/factory.js';

describeCredentialIsolation('outlook', {
  createExtension: (tokenKey) =>
    createOutlookExtension(
      { auth: { type: 'session', tokenVar: tokenKey } },
      makeFactoryCtx()
    ),
  call: { name: 'inbox', args: {} },
  okBody: { value: [] },
});
