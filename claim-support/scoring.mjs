import { initLLM } from "./llm/orchestrator.mjs";

/**
 * Build initial scoring prompt
 */
function buildInitialPrompt(segments, claim) {
  const numbered = segments
    .map((s, i) => `${i + 1}. "${s}"`)
    .join("\n");

  return `Evaluate how much each segment supports a claim.

Claim: "${claim}"

Scoring:
0.0 = strongly contradicts
0.5 = neutral
1.0 = strongly supports

Segments:
${numbered}

Return ONLY JSON array:
{"i": 1, "score": 0.734}

Rules:
- scores must be floats between 0 and 1
- no '+' signs
- no extra text`;
}


/**
 * Build anchor comparison prompt
 */
function buildAnchorPrompt(anchor, others, claim) {
  const list = others
    .map((s, idx) => `${idx + 1}. "${s}"`)
    .join("\n");

  return `Claim: "${claim}"

Compare segment A against each of the numbered segments.

A: "${anchor}"

Segments:
${list}

For each, decide which supports the claim more.

Return ONLY JSON array:
[
  {"idx": 1, "winner": "A"},
  {"idx": 2, "winner": "B"}
]

Rules:
- winner = "A" or "B"
- "B" refers to the numbered segment
- no extra text`;
}


/**
 * Sample k distinct indices excluding i
 */
function sampleIndices(n, exclude, k) {
  const result = new Set();

  while (result.size < k && result.size < n - 1) {
    const j = Math.floor(Math.random() * n);
    if (j !== exclude) result.add(j);
  }

  return [...result];
}


/**
 * Normalize scores to [0,1]
 */
function normalizeScores(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);

  if (max === min) return arr.map(() => 0.5);

  return arr.map(x => (x - min) / (max - min));
}


export async function scoreSegmentsMultiPass(
  segments,
  claim,
  options = {}
) {
  const {
    passes = 2,
    sampleSize = 5,
    verbose = true
  } = options;

  const llm = initLLM();

  const n = segments.length;

  // -------------------------
  // Precompute total LLM calls
  // -------------------------
  const totalCalls = 1 + passes * n;
  let llmCalls = 0;

  const totalStart = Date.now();

  if (verbose) {
    console.log("Scoring configuration:");
    console.log(`- Segments: ${n}`);
    console.log(`- Passes: ${passes}`);
    console.log(`- Sample size: ${sampleSize}`);
    console.log(`- Total expected LLM calls: ${totalCalls}`);
    console.log();
  }

  // -------------------------
  // PASS 0: Initial scoring
  // -------------------------
  const initStart = Date.now();

  const initialPrompt = buildInitialPrompt(segments, claim);
  const initial = await llm.sendJSON(initialPrompt);

  llmCalls++;

  const initTime = ((Date.now() - initStart) / 1000).toFixed(2);

  if (verbose) {
    console.log("Pass 0 (initial scoring):");
    console.log(`- Time: ${initTime}s`);
    console.log(`- Progress: ${llmCalls} / ${totalCalls}`);
    console.log();
  }

  let scored = segments.map((text, i) => {
    const found = initial.find(r => r.i === i + 1);
    return {
      text,
      score: found?.score ?? 0.5
    };
  });

  // -------------------------
  // REFINEMENT PASSES
  // -------------------------
  for (let pass = 0; pass < passes; pass++) {

    const passStart = Date.now();
    const callsBefore = llmCalls;

    const wins = Array(scored.length).fill(0);

    for (let i = 0; i < scored.length; i++) {
      const anchor = scored[i].text;

      const sampledIdx = sampleIndices(
        scored.length,
        i,
        sampleSize
      );

      const others = sampledIdx.map(j => scored[j].text);

      const prompt = buildAnchorPrompt(anchor, others, claim);

      const res = await llm.sendJSON(prompt);
      llmCalls++;

      for (const r of res) {
        const j = sampledIdx[r.idx - 1];

        if (r.winner === "A") {
          wins[i]++;
        } else if (r.winner === "B") {
          wins[j]++;
        }
      }
    }

    // normalize wins → [0,1]
    const refined = normalizeScores(wins);

    // blend scores
    for (let i = 0; i < scored.length; i++) {
      scored[i].score =
        0.6 * scored[i].score +
        0.4 * refined[i];
    }

    const passTime = ((Date.now() - passStart) / 1000).toFixed(2);
    const passCalls = llmCalls - callsBefore;
    const progressPct = ((llmCalls / totalCalls) * 100).toFixed(1);

    if (verbose) {
      console.log(`Pass ${pass + 1}:`);
      console.log(`- Time: ${passTime}s`);
      console.log(`- LLM calls (this pass): ${passCalls}`);
      console.log(`- Progress: ${llmCalls} / ${totalCalls} (${progressPct}%)`);
      console.log();
    }
  }

  // -------------------------
  // FINAL NORMALIZATION
  // -------------------------
  const finalScores = normalizeScores(
    scored.map(s => s.score)
  );

  scored.forEach((s, i) => {
    s.score = finalScores[i] + i * 1e-6;
    s.score = Math.max(0, Math.min(1, s.score));
  });

  // sort descending
  scored.sort((a, b) => b.score - a.score);

  // -------------------------
  // FINAL STATS
  // -------------------------
  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(2);

  if (verbose) {
    console.log("Final:");
    console.log(`- Total time: ${totalTime}s`);
    console.log(`- Total LLM calls: ${llmCalls}`);
    console.log();
  }

  return scored;
}