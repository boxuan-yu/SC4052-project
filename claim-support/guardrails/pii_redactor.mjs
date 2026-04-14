/**
 * PII Redactor — Guardrail middleware for OpenClaw
 *
 * Detects and replaces sensitive personally identifiable information (PII)
 * in free-text before it is forwarded to any downstream LLM.
 *
 * Strategy
 * --------
 *  - Regex-based detection for structured PII (email, phone, card, NRIC, etc.)
 *  - Optional per-rule validators to cut false positives (Luhn for cards, NRIC checksum)
 *  - Factory function (createRedactor) for disabling rules or injecting custom ones
 *  - Logging summarises *counts* only — raw PII values are never written to logs
 *
 * Limitations (document for callers)
 * -----------
 *  - Full names are NOT detected — unstructured name detection requires an NER model
 *    (not included). An extension point is provided via createRedactor({ extraRules }).
 *  - Freeform home addresses are NOT detected — address parsing is locale-specific
 *    and has an unacceptably high false-positive rate with pure regex.
 *  - Numeric date patterns (e.g. 15/04/1990) are redacted broadly; this may
 *    occasionally affect non-DOB dates in technical text (version stamps, etc.).
 *  - Bank account numbers without keyword context cannot be reliably distinguished
 *    from other long numeric identifiers; only keyword-anchored patterns are used.
 *  - IPv6 addresses are not currently matched.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Luhn algorithm — validates credit/debit card numbers.
 * Returning false prevents redaction of digit sequences that merely *look* like
 * card numbers (product IDs, long serial numbers, etc.).
 */
function luhnCheck(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (isEven) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Singapore NRIC / FIN checksum validation.
 * The last character is a computed check letter — validating it cuts false
 * positives for random uppercase-letter + 7-digit sequences.
 */
function validateNRIC(value) {
  const str = value.toUpperCase();
  if (!/^[STFGM]\d{7}[A-Z]$/.test(str)) return false;

  const weights = [2, 7, 6, 5, 4, 3, 2];
  const stTable = "JZIHGFEDCBA";
  const fgTable = "XWUTRQPNMLK";

  let sum = weights.reduce(
    (acc, w, i) => acc + w * parseInt(str[i + 1], 10),
    0
  );

  if (str[0] === "T" || str[0] === "G") sum += 4;
  else if (str[0] === "M") sum += 3;

  sum %= 11;

  const table = str[0] === "S" || str[0] === "T" ? stTable : fgTable;
  return table[sum] === str[8];
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

/**
 * Rule schema
 * -----------
 *  id          {string}   Unique identifier used in summary logs and for disabling
 *  placeholder {string}   Replacement text inserted in place of the matched value
 *  pattern     {RegExp}   Must use the /g flag; recreated per-call to reset lastIndex
 *  validate    {Function} Optional — called with the raw match string; return false
 *                         to leave the match untouched (suppresses false positives)
 */
const DEFAULT_RULES = [
  // -------------------------------------------------------------------------
  // Email addresses
  // Very low false-positive rate; safe to apply broadly.
  // -------------------------------------------------------------------------
  {
    id: "email",
    placeholder: "[REDACTED_EMAIL]",
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },

  // -------------------------------------------------------------------------
  // Credit / debit card numbers (13–19 digits in common 4-block groups)
  // Luhn-validated to suppress false positives from product IDs etc.
  // -------------------------------------------------------------------------
  {
    id: "credit_card",
    placeholder: "[REDACTED_CARD]",
    pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
    validate: luhnCheck,
  },

  // -------------------------------------------------------------------------
  // Singapore NRIC / FIN   [S|T|F|G|M]DDDDDDD[A–Z]
  // Checksum-validated to eliminate random alphanumeric false positives.
  // -------------------------------------------------------------------------
  {
    id: "nric",
    placeholder: "[REDACTED_ID]",
    pattern: /\b[STFGM]\d{7}[A-Z]\b/g,
    validate: validateNRIC,
  },

  // -------------------------------------------------------------------------
  // International phone numbers  +XX XXXX XXXX  /  +X-NNN-NNN-NNNN
  // Requires a leading + so it is not confused with long numeric identifiers.
  // -------------------------------------------------------------------------
  {
    id: "phone_intl",
    placeholder: "[REDACTED_PHONE]",
    pattern: /\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{4,6}\b/g,
  },

  // -------------------------------------------------------------------------
  // North-American / local phone formats
  //   (NNN) NNN-NNNN   NNN-NNN-NNNN   NNN.NNN.NNNN
  // Only matches when parentheses or dashes/dots are present — bare 10-digit
  // strings are too ambiguous (order IDs, serials) to redact safely.
  // -------------------------------------------------------------------------
  {
    id: "phone_local",
    placeholder: "[REDACTED_PHONE]",
    // (?<!\d) prevents matching in the middle of a longer digit sequence.
    // The \( format needs this instead of \b because ( is not a word character.
    pattern:
      /(?<!\d)(?:\(\d{3}\)[\s\-.]?\d{3}[\s\-.]?\d{4}|\d{3}[\-\.]\d{3}[\-\.]\d{4})\b/g,
  },

  // -------------------------------------------------------------------------
  // Passport numbers (keyword-anchored to avoid false positives)
  // Matches common formats when preceded by "passport number / no." context.
  // Stand-alone alphanumeric codes are too ambiguous without this anchor.
  // -------------------------------------------------------------------------
  {
    id: "passport",
    placeholder: "[REDACTED_PASSPORT]",
    pattern:
      /\bpassport[\s\w]*?(?:number|no\.?|num\.?)[\s#:\-]*[A-Z0-9]{6,12}\b/gi,
  },

  // -------------------------------------------------------------------------
  // Numeric dates  (DD/MM/YYYY, MM-DD-YYYY, YYYY.MM.DD, etc.)
  // Catches machine-formatted DOBs. Note: may also redact other dates in text —
  // see module-level limitations note.
  // -------------------------------------------------------------------------
  {
    id: "dob",
    placeholder: "[REDACTED_DOB]",
    pattern:
      /\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g,
  },

  // -------------------------------------------------------------------------
  // IPv4 addresses — each octet validated to 0–255
  // -------------------------------------------------------------------------
  {
    id: "ip_address",
    placeholder: "[REDACTED_IP]",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },

  // -------------------------------------------------------------------------
  // Bank account numbers — keyword-anchored only
  // Pure digit strings cannot be reliably classified without surrounding context.
  // -------------------------------------------------------------------------
  {
    id: "bank_account",
    placeholder: "[REDACTED_BANK]",
    pattern:
      /(?:(?:account|acct|bank\s+a\/c|a\/c)[\s#:\-]*\d{6,20}|\b\d{6,20}\s+(?:account|acct))\b/gi,
  },
];

// ---------------------------------------------------------------------------
// Core redaction engine
// ---------------------------------------------------------------------------

/**
 * Apply a single rule to the text, replacing all matches with the placeholder.
 *
 * @param {string} text
 * @param {object} rule
 * @returns {{ text: string, count: number }}
 */
function applyRule(text, rule) {
  // Re-create the RegExp each call to reset lastIndex (avoids stateful /g bugs)
  const re = new RegExp(rule.pattern.source, rule.pattern.flags);
  let count = 0;

  const redacted = text.replace(re, (match) => {
    if (rule.validate && !rule.validate(match)) {
      return match; // Validator rejected this candidate — leave it in place
    }
    count++;
    return rule.placeholder;
  });

  return { text: redacted, count };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redact all PII from a string using the configured rule set.
 *
 * @param {string} text       Raw input string
 * @param {object} [options]
 *   @param {Array} [options.rules]  Override the full rule set
 *
 * @returns {{ redactedText: string, summary: Record<string, number> }}
 *   redactedText — sanitized string safe to forward to the LLM
 *   summary      — { ruleId: matchCount, ... } (no raw PII values included)
 */
export function redactPII(text, options = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return { redactedText: text, summary: {} };
  }

  const rules = options.rules ?? DEFAULT_RULES;
  const summary = {};
  let current = text;

  for (const rule of rules) {
    const { text: next, count } = applyRule(current, rule);
    if (count > 0) {
      summary[rule.id] = (summary[rule.id] ?? 0) + count;
    }
    current = next;
  }

  return { redactedText: current, summary };
}

/**
 * Factory: create a redactor with a customised rule set.
 * Useful for disabling noisy rules in specific contexts or for adding
 * domain-specific patterns (e.g. internal employee IDs, NER output).
 *
 * @param {object} [options]
 *   @param {Array}    [options.extraRules]    Additional rules appended to the set
 *   @param {string[]} [options.disableRules]  Rule IDs to exclude
 *
 * @returns {typeof redactPII}
 *
 * @example
 *   // Disable date redaction (noisy in technical documents) and add a custom rule
 *   const redact = createRedactor({
 *     disableRules: ["dob"],
 *     extraRules: [{
 *       id: "employee_id",
 *       placeholder: "[REDACTED_ID]",
 *       pattern: /\bEMP-\d{6}\b/g,
 *     }],
 *   });
 *   const { redactedText } = redact("Employee EMP-001234 called from +65 9123 4567");
 */
export function createRedactor({ extraRules = [], disableRules = [] } = {}) {
  const rules = [
    ...DEFAULT_RULES.filter((r) => !disableRules.includes(r.id)),
    ...extraRules,
  ];

  return (text, options = {}) => redactPII(text, { ...options, rules });
}

/**
 * Format a redaction summary object for safe logging.
 * Returns a human-readable string of counts only — no raw PII values.
 *
 * @param {Record<string, number>} summary
 * @returns {string}
 *
 * @example
 *   formatRedactionSummary({ email: 2, phone_intl: 1 })
 *   // → "email×2, phone_intl×1"
 */
export function formatRedactionSummary(summary) {
  const entries = Object.entries(summary);
  if (entries.length === 0) return "none";
  return entries.map(([id, n]) => (n === 1 ? id : `${id}×${n}`)).join(", ");
}
