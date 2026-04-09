import { OpenAIWrapper } from "./llm_openai.mjs";

/**
 * Detect which LLM to use based on environment
 */
function detectProvider() {
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  // future:
  // if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  // if (process.env.LOCAL_MODEL) return "local";

  throw new Error(
    "No LLM provider configured.\n" +
    "Set OPENAI_API_KEY (or other provider keys)."
  );
}


/**
 * Initialise LLM based on detected provider
 */
export function initLLM() {
  const provider = detectProvider();

  switch (provider) {
    case "openai":
      return OpenAIWrapper.init();

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}