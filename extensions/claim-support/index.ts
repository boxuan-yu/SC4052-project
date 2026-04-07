import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Splits plain text into individual sentences.
 *
 * Strategy:
 *  - Break on sentence-ending punctuation (. ! ?) followed by whitespace +
 *    an uppercase letter / quote / opening bracket (i.e. a new sentence start).
 *  - Also break on blank lines (paragraph boundaries).
 *  - Filter out fragments shorter than 20 characters to avoid noise.
 */
function splitSentences(text: string): string[] {
  const normalised = text.replace(/\r\n/g, "\n");

  // Split on:
  //   [.!?] <whitespace> <uppercase-or-quote>   (classic sentence boundary)
  //   two or more consecutive newlines           (paragraph break)
  const raw = normalised.split(
    /(?<=[.!?])\s+(?=[A-Z"'([\u2018\u201C])|(?:\n{2,})/,
  );

  return raw
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 20);
}

// ---------------------------------------------------------------------------
// Segment building
// ---------------------------------------------------------------------------

interface Segment {
  text: string;
  kind: "sentence" | "pair";
  nums: number[]; // 1-based sentence number(s)
}

/**
 * Returns individual sentences and, optionally, every consecutive pair.
 * Keeping pairs as segments lets the ranker find evidence that spans a
 * sentence boundary (e.g. a qualifier in one sentence modifying a claim in
 * the next).
 */
function buildSegments(sentences: string[], includePairs: boolean): Segment[] {
  const segments: Segment[] = sentences.map((text, i) => ({
    text,
    kind: "sentence",
    nums: [i + 1],
  }));

  if (includePairs) {
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
// Rating via Anthropic
// ---------------------------------------------------------------------------

interface Rating {
  i: number;
  score: number; // -2 … +2
  reason: string;
}

async function rateSegments(
  segments: Segment[],
  claim: string,
  apiKey: string | undefined,
): Promise<Rating[]> {
  const client = new OpenAI({ apiKey });

  const numberedList = segments
    .map((seg, idx) => `${idx + 1}. "${seg.text}"`)
    .join("\n");

  const prompt = `You are rating how much each text segment supports a specific claim.

Claim: "${claim}"

Support scale:
-2 = Strongly contradicts the claim
-1 = Contradicts or undermines the claim
 0 = Neutral, tangential, or unrelated to the claim
+1 = Supports the claim
+2 = Strongly supports the claim

Text segments to rate:
${numberedList}

Respond ONLY with a valid JSON array — no markdown, no explanation, no other text.
Each element must have exactly: "i" (1-based index), "score" (integer -2..2), "reason" (one sentence).
Example format: [{"i":1,"score":1,"reason":"..."},{"i":2,"score":-1,"reason":"..."}]`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.choices[0]?.message?.content?.trim() ?? "";

  // Extract the JSON array even if the model wraps it in markdown fences
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not find JSON array in model response:\n${rawText}`);
  }

  return JSON.parse(jsonMatch[0]) as Rating[];
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function scoreLabel(score: number): string {
  if (score >= 2) return "STRONGLY SUPPORTS";
  if (score >= 1) return "SUPPORTS";
  if (score === 0) return "NEUTRAL";
  if (score >= -1) return "CONTRADICTS";
  return "STRONGLY CONTRADICTS";
}

function scoreBar(score: number): string {
  return (["▼▼", " ▼", " ·", " ▲", "▲▲"] as const)[score + 2] ?? "??";
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default definePluginEntry({
  id: "claim-support",
  name: "Claim Support Analyzer",
  description:
    "Analyzes document text to rank sentences by how much they support a given claim",
  register(api) {
    api.registerTool({
      name: "analyze_claim_support",
      description:
        "Given plain document text and a claim, splits the text into sentences (and consecutive sentence-pairs), " +
        "asks an AI to rate each segment from -2 (strongly contradicts) to +2 (strongly supports), " +
        "and returns all segments sorted from greatest support to greatest disagreement. " +
        "Use this when you want to quickly locate the parts of a document most relevant to a specific claim.",
      parameters: Type.Object({
        text: Type.String({
          description:
            "Plain document text (already extracted from a PDF or other source) to be analysed.",
        }),
        claim: Type.String({
          description:
            "The claim to evaluate support for, e.g. 'Renewable energy reduces carbon emissions'.",
        }),
        include_pairs: Type.Optional(
          Type.Boolean({
            description:
              "Whether to also analyse consecutive sentence-pairs as segments (default: true). " +
              "Pairs capture evidence that spans a sentence boundary.",
          }),
        ),
        top_n: Type.Optional(
          Type.Number({
            description:
              "Return only the top N segments (by score). Omit to return all segments.",
          }),
        ),
      }),

      async execute(_id, params) {
        const { text, claim, include_pairs = true, top_n } = params;

        // ---- 1. Split text into sentences --------------------------------
        const sentences = splitSentences(text);
        if (sentences.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No sentences could be extracted from the provided text.",
              },
            ],
          };
        }

        // ---- 2. Build segments (sentences + optional pairs) --------------
        const allSegments = buildSegments(sentences, include_pairs);

        // Cap segment count to avoid prompt token overflow
        const MAX_SEGMENTS = 60;
        const segments = allSegments.slice(0, MAX_SEGMENTS);

        // ---- 3. Rate segments via LLM ------------------------------------
        let ratings: Rating[];
        try {
          ratings = await rateSegments(
            segments,
            claim,
            process.env.OPENAI_API_KEY,
          );
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Rating failed: ${String(err)}`,
              },
            ],
          };
        }

        // ---- 4. Join ratings with segment metadata -----------------------
        const rated = ratings
          .map((r) => ({ ...r, segment: segments[r.i - 1] }))
          .filter((r) => r.segment != null && typeof r.score === "number");

        // Sort: highest support first
        rated.sort((a, b) => b.score - a.score);

        const shown = top_n != null ? rated.slice(0, top_n) : rated;

        // ---- 5. Format output --------------------------------------------
        const lines: string[] = [
          `Claim: "${claim}"`,
          "",
          `Analysed ${sentences.length} sentence${sentences.length !== 1 ? "s" : ""} → ${segments.length} segment${segments.length !== 1 ? "s" : ""}` +
            (allSegments.length > MAX_SEGMENTS
              ? ` (first ${MAX_SEGMENTS} shown due to length limit)`
              : "") +
            (top_n != null ? ` | showing top ${shown.length}` : ""),
          "─".repeat(60),
          "",
        ];

        let lastScore: number | null = null;
        for (const r of shown) {
          if (r.score !== lastScore) {
            if (lastScore !== null) lines.push("");
            lines.push(`${scoreBar(r.score)}  ${scoreLabel(r.score)}`);
            lastScore = r.score;
          }

          const tag =
            r.segment.kind === "pair"
              ? `[sentences ${r.segment.nums.join("+")}]`
              : `[sentence ${r.segment.nums[0]}]`;

          lines.push(`   ${tag}`);
          lines.push(`   "${r.segment.text}"`);
          lines.push(`    → ${r.reason}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    });
  },
});
