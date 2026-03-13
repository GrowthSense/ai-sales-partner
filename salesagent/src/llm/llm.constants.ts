/**
 * Dependency-injection tokens for the LLM abstraction layer.
 * Use these tokens in @Inject() decorators so that the concrete
 * OpenAI provider can be swapped for any other implementation
 * (Anthropic, Gemini, local Ollama, etc.) without touching consumers.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const LLM_USAGE_TRACKER = Symbol('LLM_USAGE_TRACKER');
