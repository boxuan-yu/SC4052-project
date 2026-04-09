/**
 * Split raw text into sentences (fast heuristic).
 *
 * - Splits on ., !, ?
 * - Normalises whitespace
 * - Filters very short fragments
 */
function splitSentences(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Invalid input: expected non-empty string");
  }

  return rawText
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().replace(/\s+/g, " "))
    .filter(s => s.length >= 20);
}


/**
 * CLI text handler
 *
 * Input:
 *   rawText (string)
 *
 * Output:
 *   string[] (sentences)
 */
export function cliTextToSentences(rawText) {
  const sentences = splitSentences(rawText);

  if (sentences.length === 0) {
    throw new Error("No valid sentences extracted from input text.");
  }

  return sentences;
}