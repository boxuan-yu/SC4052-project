// io/file.mjs

import { readFileSync, existsSync } from "node:fs";

/**
 * Internal helper — NOT exported
 */
function splitSentences(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().replace(/\s+/g, " "))
    .filter(s => s.length >= 20);
}


/**
 * Read a local file and convert its contents → sentences
 *
 * Input:
 *   filePath (string)
 *
 * Output:
 *   string[] (sentences)
 */
export function fileToSentences(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid file path.");
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rawText = readFileSync(filePath, "utf8");
  console.log("RAW TEXT LENGTH:", rawText.length);
  console.log("RAW TEXT PREVIEW:", rawText.slice(0, 200));

  if (!rawText || rawText.trim().length === 0) {
    throw new Error("File is empty.");
  }

  const sentences = splitSentences(rawText);

  if (sentences.length === 0) {
    throw new Error("No valid sentences extracted from file.");
  }

  return sentences;
}