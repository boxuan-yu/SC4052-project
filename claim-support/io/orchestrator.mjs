import { existsSync, statSync } from "node:fs";
import { cliTextToSentences } from "./input_cli_argument.mjs";
import { fileToSentences } from "./input_local_txt.mjs";

/**
 * Input handlers
 */
const IO_HANDLERS = {
  input_cli_argument: cliTextToSentences,
  input_local_txt: fileToSentences,
};


/**
 * Detect input type
 */
function detectInputType(arg) {
  if (!arg) {
    throw new Error("Missing input (text or file path).");
  }

  // Check if it's a real file
  if (existsSync(arg) && statSync(arg).isFile()) {
    return "input_local_txt";
  }

  return "input_cli_argument";
}


/**
 * Extract input (skip claim)
 */
function extractInput(argv) {
  const args = argv.slice(2);

  // argv[2] = claim (handled above this layer)
  // argv[3] = input
  const input = args[1];

  if (!input) {
    throw new Error("Missing input (text or file path).");
  }

  return input;
}


/**
 * I/O orchestrator
 */
export function getSentencesFromIO(input) {
  // ✅ NEW: direct text mode (for OpenClaw tool)
  if (typeof input === "object" && input.text) {
    return cliTextToSentences(input.text);
  }

  // ✅ OLD: CLI mode (unchanged)
  const extracted = extractInput(input);
  const inputType = detectInputType(extracted);

  const handler = IO_HANDLERS[inputType];

  if (!handler) {
    throw new Error(`Unsupported input type: ${inputType}`);
  }

  return handler(extracted);
}