---
name: claim-verifier
description: Extract and rank sentences from a body of text that support a given claim. Use when a user wants to verify a claim against a document, find evidence for a statement, check if a text backs up an argument, or identify which parts of a passage support a specific assertion. Triggers on phrases like "find evidence for", "does this text support", "verify this claim", "which sentences support", "fact-check this against", "what does this say about".
---

# Claim Verifier

Use the `find_claim_evidence` tool to extract and rank sentences from text by how strongly they support a given claim.

## How It Works

The tool runs a multi-pass LLM scoring pipeline:

1. **Initial pass** — each sentence is scored 0.0–1.0 for how strongly it supports the claim
2. **Refinement passes** — pairwise comparisons between sentences to re-rank by relative support
3. **Final output** — top 5 sentences sorted by score, highest first

Scores:
- `1.0` — strongly supports the claim
- `0.5` — neutral / tangentially related
- `0.0` — contradicts the claim

## Inputs

| Parameter | Type | Description |
|---|---|---|
| `claim` | string | A declarative statement to verify |
| `text` | string | The body of text to search through |

## When to Use

- "Does this article support the claim that X?"
- "Find evidence in this document for Y"
- "Verify the claim that Z using this text"
- "Which sentences in this passage back up the argument that..."

## When NOT to Use

- User just wants a summary → use the `summarize` skill instead
- Text has fewer than 3 sentences (too few to compare meaningfully)
- User wants real-time or web-sourced fact-checking → this only analyses text provided directly

## Tips for Good Results

**Claim formatting:**
- Use a declarative statement, not a question
  - Bad: "Does exercise help mental health?"
  - Good: "Exercise improves mental health"
- Keep the claim specific and concise — vague claims produce noisy scores
- If the user gives a question, rephrase it into a claim before calling the tool

**Text formatting:**
- More sentences = better ranking (pairwise comparison works best with 6+ sentences)
- For very long documents, extract the most relevant section before passing to the tool
- Plain text only — strip markdown or HTML before passing if needed

## Interpreting Results

Results are returned in this format:

```
Top supporting evidence:

[0.921] Regular physical activity has been shown to reduce symptoms of depression.
[0.834] People who exercise regularly report lower stress levels and better sleep.
[0.612] Athletes often report higher life satisfaction than sedentary individuals.
```

- Scores above `0.7` → strong support for the claim
- Scores between `0.4–0.7` → partial or indirect support
- All scores below `0.4` → the text likely does not support the claim; tell the user this clearly

Always present the top results and briefly explain what they mean in plain language. Do not just paste the raw output — summarise what the evidence shows.
