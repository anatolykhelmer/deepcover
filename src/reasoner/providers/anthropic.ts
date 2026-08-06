import type { LLMProvider } from './base';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

const MISSING_SDK_MESSAGE =
  'Anthropic provider requires the optional peer dependency @anthropic-ai/sdk. ' +
  'Install it with: npm install @anthropic-ai/sdk';

type AnthropicClient = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

type AnthropicConstructor = new (options: { apiKey: string }) => AnthropicClient;

/**
 * Real Anthropic provider using the Messages API.
 * Loads `@anthropic-ai/sdk` via dynamic import so the package stays optional.
 */
export class AnthropicProvider implements LLMProvider {
  private clientPromise: Promise<AnthropicClient> | null = null;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-sonnet-4-20250514';
  }

  private async getClient(): Promise<AnthropicClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let Anthropic: AnthropicConstructor;
        try {
          // Optional peer — may be absent at install time.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = require('@anthropic-ai/sdk') as { default?: AnthropicConstructor } & AnthropicConstructor;
          Anthropic = (mod.default ?? mod) as AnthropicConstructor;
        } catch {
          throw new Error(MISSING_SDK_MESSAGE);
        }
        return new Anthropic({ apiKey: this.apiKey });
      })();
    }
    return this.clientPromise;
  }

  async analyze(system: string, user: string): Promise<string> {
    const client = await this.getClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const content = response.content.find((c) => c.type === 'text');
    if (!content || content.type !== 'text' || typeof content.text !== 'string') {
      return '';
    }

    return content.text;
  }
}
