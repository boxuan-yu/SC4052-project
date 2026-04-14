import { getSentencesFromIO } from "./io/orchestrator.mjs";
import { scoreSegmentsMultiPass } from "./scoring.mjs";
import { redactPII, formatRedactionSummary } from "./guardrails/pii_redactor.mjs";

/**
 * Return a sanitized copy of `input` with PII stripped from the text body.
 * Handles the direct-object path ({ text: "..." }) used by the OpenClaw tool.
 * The CLI argv path carries no accessible raw text at this layer; that path
 * is covered by the per-sentence pass in analyzeClaim below.
 *
 * @param {object|Array} input
 * @returns {object|Array} sanitized input
 */
function sanitizeInput(input) {
  if (typeof input === "object" && input !== null && typeof input.text === "string") {
    const { redactedText, summary } = redactPII(input.text);
    if (Object.keys(summary).length > 0) {
      console.log(
        `[PII Guardrail] text body redactions: ${formatRedactionSummary(summary)}`
      );
    }
    return { ...input, text: redactedText };
  }
  return input;
}

export async function analyzeClaim(claim, input) {
  // ── PII Guardrail pass 1: redact the claim string ──────────────────────
  const { redactedText: sanitizedClaim, summary: claimSummary } = redactPII(claim);
  if (Object.keys(claimSummary).length > 0) {
    console.log(
      `[PII Guardrail] claim redactions: ${formatRedactionSummary(claimSummary)}`
    );
  }

  // ── PII Guardrail pass 2: redact raw text body before sentence splitting ─
  // Ensures PII that spans what would become multiple sentences is caught
  // as a single token (e.g. an email address near a sentence boundary).
  const sanitizedInput = sanitizeInput(input);

  const sentences = getSentencesFromIO(sanitizedInput);

  if (!sentences || sentences.length === 0) {
    throw new Error("No sentences extracted.");
  }

  // ── PII Guardrail pass 3: redact each extracted sentence ─────────────────
  // Belt-and-suspenders pass that also covers the CLI argv path where the raw
  // text string is not accessible above. Any residual PII introduced by the
  // sentence-splitting boundary is caught here.
  const sanitizedSentences = sentences.map((sentence) => {
    const { redactedText, summary } = redactPII(sentence);
    if (Object.keys(summary).length > 0) {
      console.log(
        `[PII Guardrail] sentence redactions: ${formatRedactionSummary(summary)}`
      );
    }
    return redactedText;
  });

  const results = await scoreSegmentsMultiPass(
    sanitizedSentences,
    sanitizedClaim,
    {
      passes: 3,
      sampleSize: 6
    }
  );

  return results;
}
