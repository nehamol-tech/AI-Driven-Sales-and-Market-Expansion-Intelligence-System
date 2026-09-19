import { env } from "../../config/env.js";
import type { AIProvider } from "./ai-provider.interface.js";
import { MockAIProvider } from "./providers/mock.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";

/**
 * Reads AI_PROVIDER from env (`openai` | `anthropic` | `mock`) and returns
 * the corresponding provider instance. Defaults to `mock` if unset or if the
 * required API key for the selected provider is missing. Not called by any
 * route in Phase 1.
 */
export function createAIProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case "openai":
      if (!env.OPENAI_API_KEY) {
        return new MockAIProvider();
      }
      return new OpenAIProvider(env.OPENAI_API_KEY);
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) {
        return new MockAIProvider();
      }
      return new AnthropicProvider(env.ANTHROPIC_API_KEY);
    case "mock":
    default:
      return new MockAIProvider();
  }
}
