/**
 * Provider-agnostic abstraction for LLM completions. Phase 2's lead-scoring
 * pipeline is the first real caller — `generateCompletion` returns both the
 * text content and (when the underlying API reports it) token usage, so
 * usage can be captured for future cost reporting without redesigning this
 * interface again.
 */
export interface AIProviderOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AIProviderCompletion {
  content: string;
  usage?: AIProviderUsage;
}

export interface AIProvider {
  readonly name: string;
  generateCompletion(prompt: string, options?: AIProviderOptions): Promise<AIProviderCompletion>;
}
