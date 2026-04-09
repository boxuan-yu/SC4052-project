import { getSentencesFromIO } from "./io/orchestrator.mjs";
import { scoreSegmentsMultiPass } from "./scoring.mjs";

export async function analyzeClaim(claim, input) {
  const sentences = getSentencesFromIO(input);

  if (!sentences || sentences.length === 0) {
    throw new Error("No sentences extracted.");
  }

  const results = await scoreSegmentsMultiPass(
    sentences,
    claim,
    {
      passes: 3,
      sampleSize: 6
    }
  );

  return results;
}