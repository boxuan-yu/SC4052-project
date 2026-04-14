---
name: claim-verifier
description: Extract and rank sentences from text by relevance to a claim. Use when a user wants to verify a claim against a document, find evidence for a statement, or identify which parts of a passage relate to an assertion. Triggers on "find evidence for", "does this text support", "verify this claim", "which sentences support", "fact-check this against", "what does this say about".
---

# Claim Verifier

Use `find_claim_evidence` to rank sentences in a body of text by relevance to a claim, then use `query_claim_evidence` to let the user page through the stored results.

## Scores are relative, not absolute

Scores are normalised within the document. They express how each sentence ranks relative to the other sentences — not whether the claim is supported or contradicted in absolute terms.

- In a fully contradictory document, `1.0` = least rejection, `0.0` = most rejection.
- In a fully agreeing document, `0.0` = weakest agreement, `1.0` = strongest agreement.

**Never interpret or editorialize the results.** Present the ranked segments and let the user judge for themselves.

## Tools

### `find_claim_evidence`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `claim` | string | yes | Declarative statement to verify |
| `text` | string | yes | Body of text to search through |

Returns a session ID, total segment count, and a preview of the top 10.

### `query_claim_evidence`

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `sessionId` | string | yes | — | Session ID from `find_claim_evidence` |
| `mode` | string | no | `"top"` | `"top"` = highest-scored first; `"bottom"` = lowest-scored first |
| `offset` | number | no | `0` | Start position in the sorted list |
| `limit` | number | no | `10` | Number of segments to return |

## Workflow

1. If the user provides a question instead of a declarative statement, rephrase it into a claim before calling the tool.
2. Call `find_claim_evidence` with the claim and text.
3. From the returned preview, present the **top 5** and **bottom 5** segments using the raw `[score] sentence` format. Do not reformat, summarise, or add commentary about what the evidence "shows".
4. Tell the user how many total segments were ranked and that they can ask for more (e.g. "next 10", "show bottom 10", or a specific offset range).
5. Fulfil subsequent navigation requests with `query_claim_evidence`.

## Response template

```
Here are the top 5 and bottom 5 ranked segments for your claim.

**Highest-scored:**

[0.921] …
[0.834] …
[0.612] …
[0.589] …
[0.540] …

**Lowest-scored:**

[0.045] …
[0.061] …
[0.102] …
[0.130] …
[0.188] …

There are {N} ranked segments in total. Ask to see the next batch, jump to a specific range, or view from the bottom up.
```

## Constraints

- Never state whether the claim is supported or contradicted. The scores are relative and only the user can make that judgement.
- Never apply absolute thresholds (e.g. "above 0.7 means strong support").
- Never omit the scores from the output.
- Always offer both top and bottom segments on first presentation.
- Always offer navigation to additional results.

## When to use

- "Does this article support the claim that X?"
- "Find evidence in this document for Y"
- "Verify the claim that Z using this text"
- "Which sentences back up the argument that…"

## When NOT to use

- User wants a summary (use a summarise skill instead)
- Text has fewer than 3 sentences
- User wants web-sourced fact-checking (this only analyses provided text)

## Tips

- Keep claims specific and concise — vague claims produce noisy rankings.
- More sentences produce better rankings; pairwise comparison works best with 6+ sentences.
- Strip markdown or HTML from text before passing it to the tool.
