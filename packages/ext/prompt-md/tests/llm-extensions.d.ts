/**
 * Type declarations for the sibling LLM extension package names that
 * vitest.config.ts aliases to source files. They stay ambient so the package
 * declares no devDependency on sibling extensions.
 */

declare module '@rcrsr/rill-ext-anthropic' {
  export function createAnthropicExtension(config: {
    api_key: string;
    model: string;
  }): import('@rcrsr/rill').ExtensionFactoryResult;
}

declare module '@rcrsr/rill-ext-openai' {
  export function createOpenAIExtension(config: {
    api_key: string;
    model: string;
  }): import('@rcrsr/rill').ExtensionFactoryResult;
}

declare module '@rcrsr/rill-ext-gemini' {
  export function createGeminiExtension(config: {
    api_key: string;
    model: string;
  }): import('@rcrsr/rill').ExtensionFactoryResult;
}
