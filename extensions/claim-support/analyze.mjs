#!/usr/bin/env node
/**
 * Claim Support Analyzer — standalone runner
 *
 * Usage:
 *   node analyze.mjs "<claim>" "<document text>"
 *   node analyze.mjs "<claim>" --file path/to/document.txt
 *
 * API key (pick one):
 *   Set ANTHROPIC_API_KEY in your environment, or pass it as --key <key>
 *
 * Examples:
 *   OPENAI_API_KEY=sk-... node analyze.mjs \
 *     "Vaccines are safe and effective" \
 *     "Clinical trials showed strong efficacy. A small number of participants reported mild side effects. The placebo group showed no improvement."
 *
 *   node analyze.mjs "Climate change is human-caused" --file paper.txt --key sk-...
 *   node analyze.mjs "Climate change is human-caused" --file paper.txt --no-pairs --top 5
 */

import { readFileSync, existsSync } from "node:fs";
import OpenAI from "openai";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`
Claim Support Analyzer
======================
Ranks sentences in a document by how much they support (or contradict) a claim.

Usage:
  node analyze.mjs "<claim>" "<document text>"
  node analyze.mjs "<claim>" --file <path>   [options]

Options:
  --file <path>    Read document text from a file instead of inline
  --key  <key>     Anthropic API key (overrides ANTHROPIC_API_KEY env var)
  --no-pairs       Only analyse individual sentences, not consecutive pairs
  --top  <n>       Show only the top N segments
  --help           Show this help
`);
  process.exit(0);
}

let claim = null;
let text = null;
let filePath = null;
let apiKey = process.env.OPENAI_API_KEY;
let includePairs = true;
let topN = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") {
    filePath = args[++i];
  } else if (args[i] === "--key") {
    apiKey = args[++i];
  } else if (args[i] === "--no-pairs") {
    includePairs = false;
  } else if (args[i] === "--top") {
    topN = parseInt(args[++i], 10);
  } else if (claim === null) {
    claim = args[i];
  } else if (text === null && filePath === null) {
    text = args[i];
  }
}

if (!claim) {
  console.error("Error: provide a claim as the first argument.");
  process.exit(1);
}

if (filePath) {
  if (!existsSync(filePath)) {
    console.error(`Error: file not found: ${filePath}`);
    process.exit(1);
  }
  text = readFileSync(filePath, "utf8");
} else if (!text) {
  console.error(
    "Error: provide document text as the second argument or use --file <path>.",
  );
  process.exit(1);
}

if (!apiKey) {
  console.error(
    "Error: OpenAI API key required.\n" +
      "  Set OPENAI_API_KEY in your environment, or pass --key <key>.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

function splitSentences(raw) {
  const normalised = raw.replace(/\r\n/g, "\n");
  const parts = normalised.split(
    /(?<=[.!?])\s+(?=[A-Z"'([\u2018\u201C])|(?:\n{2,})/,
  );
  return parts
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 20);
}

// ---------------------------------------------------------------------------
// Segment building  (individual sentences + consecutive pairs)
// ---------------------------------------------------------------------------

function buildSegments(sentences, pairs) {
  const segments = sentences.map((text, i) => ({
    text,
    kind: "sentence",
    nums: [i + 1],
  }));

  if (pairs) {
    for (let i = 0; i < sentences.length - 1; i++) {
      segments.push({
        text: `${sentences[i]} ${sentences[i + 1]}`,
        kind: "pair",
        nums: [i + 1, i + 2],
      });
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// LLM rating
// ---------------------------------------------------------------------------

async function rateSegments(segments, claimText, key) {
  const client = new OpenAI({ apiKey: key });

  const numberedList = segments
    .map((seg, idx) => `${idx + 1}. "${seg.text}"`)
    .join("\n");

  const prompt = `You are rating how much each text segment supports a specific claim.

Claim: "${claimText}"

Support scale:
-2 = Strongly contradicts the claim
-1 = Contradicts or undermines the claim
 0 = Neutral, tangential, or unrelated to the claim
+1 = Supports the claim
+2 = Strongly supports the claim

Text segments to rate:
${numberedList}

Respond ONLY with a valid JSON array — no markdown, no explanation, no other text.
Each element: {"i": <1-based index>, "score": <integer -2..2>, "reason": "<one sentence>"}`;

  const response = await client.chat.completions.create({
    model: process.env.MODEL ?? "gpt-4o-mini",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.choices[0]?.message?.content?.trim() ?? "";

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(
      `Could not find JSON array in model response:\n${rawText}`,
    );
  }

  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const SCORE_LABEL = [
  "STRONGLY CONTRADICTS",
  "CONTRADICTS",
  "NEUTRAL",
  "SUPPORTS",
  "STRONGLY SUPPORTS",
];
const SCORE_BAR = ["▼▼", " ▼", " ·", " ▲", "▲▲"];

function scoreLabel(score) {
  return SCORE_LABEL[score + 2] ?? "?";
}
function scoreBar(score) {
  return SCORE_BAR[score + 2] ?? "?";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MAX_SEGMENTS = 60;

const sentences = splitSentences(text);
if (sentences.length === 0) {
  console.error("No sentences could be extracted from the provided text.");
  process.exit(1);
}

const allSegments = buildSegments(sentences, includePairs);
const segments = allSegments.slice(0, MAX_SEGMENTS);

console.log(`\nClaim: "${claim}"`);
console.log(
  `Analysing ${sentences.length} sentences → ${segments.length} segments…\n`,
);

let ratings;
try {
  ratings = await rateSegments(segments, claim, apiKey);
} catch (err) {
  console.error("Rating failed:", err.message);
  process.exit(1);
}

// Join ratings with segment metadata
const rated = ratings
  .map((r) => ({ ...r, segment: segments[r.i - 1] }))
  .filter((r) => r.segment != null && typeof r.score === "number");

// Sort: highest support first
rated.sort((a, b) => b.score - a.score);

const shown = topN != null ? rated.slice(0, topN) : rated;

// Print results
console.log("─".repeat(60));
let lastScore = null;
for (const r of shown) {
  if (r.score !== lastScore) {
    if (lastScore !== null) console.log();
    console.log(`${scoreBar(r.score)}  ${scoreLabel(r.score)}`);
    lastScore = r.score;
  }
  const tag =
    r.segment.kind === "pair"
      ? `[sentences ${r.segment.nums.join("+")}]`
      : `[sentence ${r.segment.nums[0]}]`;
  console.log(`   ${tag}`);
  console.log(`   "${r.segment.text}"`);
  console.log(`    → ${r.reason}`);
}
console.log();
