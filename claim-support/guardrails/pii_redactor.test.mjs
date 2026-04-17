/**
 * Unit tests for pii_redactor.mjs
 *
 * Run with:
 *   node guardrails/pii_redactor.test.mjs
 */

import { redactPII, createRedactor, formatRedactionSummary } from "./pii_redactor.mjs";

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(` ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = "") {
  if (actual !== expected) {
    throw new Error(
      `${message}\n     Expected: ${JSON.stringify(expected)}\n     Got:      ${JSON.stringify(actual)}`
    );
  }
}

function assertContains(str, substring) {
  if (!str.includes(substring)) {
    throw new Error(`Expected "${str}" to contain "${substring}"`);
  }
}

function assertNotContains(str, substring) {
  if (str.includes(substring)) {
    throw new Error(`Expected "${str}" NOT to contain "${substring}"`);
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

console.log("\nEmail");

test("redacts a simple email address", () => {
  const { redactedText } = redactPII("Contact me at alice@example.com please.");
  assertNotContains(redactedText, "alice@example.com");
  assertContains(redactedText, "[REDACTED_EMAIL]");
});

test("redacts multiple emails in one string", () => {
  const { redactedText, summary } = redactPII("From bob@mail.org to carol@work.net.");
  assertNotContains(redactedText, "bob@mail.org");
  assertNotContains(redactedText, "carol@work.net");
  assertEqual(summary.email, 2);
});

test("does not redact a plain domain without local part", () => {
  const { redactedText } = redactPII("Visit example.com for details.");
  assertEqual(redactedText, "Visit example.com for details.");
});

// ---------------------------------------------------------------------------
// Credit card (Luhn-validated)
// ---------------------------------------------------------------------------

console.log("\nCredit card");

test("redacts a valid Visa card number with spaces", () => {
  // 4111 1111 1111 1111 passes Luhn
  const { redactedText } = redactPII("My card is 4111 1111 1111 1111, thanks.");
  assertNotContains(redactedText, "4111");
  assertContains(redactedText, "[REDACTED_CARD]");
});

test("redacts a valid Mastercard number with dashes", () => {
  // 5500-0000-0000-0004 passes Luhn
  const { redactedText } = redactPII("Card: 5500-0000-0000-0004.");
  assertContains(redactedText, "[REDACTED_CARD]");
});

test("does NOT redact a 16-digit sequence that fails Luhn", () => {
  // 1234 5678 9012 3456 — does NOT pass Luhn
  const { redactedText, summary } = redactPII("Product ID: 1234 5678 9012 3456.");
  assertEqual(summary.credit_card, undefined, "Should not count a failing Luhn");
});

// ---------------------------------------------------------------------------
// Singapore NRIC
// ---------------------------------------------------------------------------

console.log("\nSingapore NRIC / FIN");

test("redacts a valid NRIC (S-series)", () => {
  // S1234567D: digits 1234567 → sum=106, no offset → 106%11=7 → stTable[7]='D' ✓
  const { redactedText } = redactPII("NRIC: S1234567D.");
  assertNotContains(redactedText, "S1234567D");
  assertContains(redactedText, "[REDACTED_ID]");
});

test("redacts a valid NRIC (T-series)", () => {
  // T1234567J: digits 1234567 → sum=106, +4 for T → 110%11=0 → stTable[0]='J' ✓
  const { redactedText } = redactPII("NRIC: T1234567J.");
  assertNotContains(redactedText, "T1234567J");
  assertContains(redactedText, "[REDACTED_ID]");
});

test("does NOT redact a string that looks like NRIC but fails checksum", () => {
  // S9999999Z — checksum will not match for this combination
  const { summary } = redactPII("Code: S9999999Z.");
  assertEqual(summary.nric, undefined, "Checksum failure should suppress redaction");
});

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

console.log("\nPhone numbers");

test("redacts international phone with + prefix", () => {
  const { redactedText } = redactPII("Call +65 9123 4567 now.");
  assertNotContains(redactedText, "+65");
  assertContains(redactedText, "[REDACTED_PHONE]");
});

test("redacts US format with parentheses", () => {
  const { redactedText } = redactPII("Reach me at (800) 555-0123.");
  assertNotContains(redactedText, "(800)");
  assertContains(redactedText, "[REDACTED_PHONE]");
});

test("redacts dashed 10-digit phone", () => {
  const { redactedText } = redactPII("Phone: 800-555-0123.");
  assertContains(redactedText, "[REDACTED_PHONE]");
});

test("does NOT redact a bare 10-digit number (ambiguous)", () => {
  // Without dashes/parens this could be an order ID
  const { summary } = redactPII("Order 8005550123 dispatched.");
  assertEqual(summary.phone_local, undefined);
  assertEqual(summary.phone_intl, undefined);
});

// ---------------------------------------------------------------------------
// Passport (keyword-anchored)
// ---------------------------------------------------------------------------

console.log("\nPassport numbers");

test("redacts passport number when preceded by keyword", () => {
  const { redactedText } = redactPII("Passport number: A12345678.");
  assertNotContains(redactedText, "A12345678");
  assertContains(redactedText, "[REDACTED_PASSPORT]");
});

test("redacts passport no. abbreviation", () => {
  const { redactedText } = redactPII("Passport no. AB1234567 issued.");
  assertNotContains(redactedText, "AB1234567");
  assertContains(redactedText, "[REDACTED_PASSPORT]");
});

test("does NOT redact standalone alphanumeric codes without passport keyword", () => {
  const { summary } = redactPII("Serial: AB1234567.");
  assertEqual(summary.passport, undefined, "No keyword context — should not redact");
});

// ---------------------------------------------------------------------------
// Dates of birth
// ---------------------------------------------------------------------------

console.log("\nNumeric dates");

test("redacts DD/MM/YYYY", () => {
  const { redactedText } = redactPII("DOB: 15/04/1990.");
  assertNotContains(redactedText, "15/04/1990");
  assertContains(redactedText, "[REDACTED_DOB]");
});

test("redacts YYYY-MM-DD", () => {
  const { redactedText } = redactPII("Born on 1990-04-15.");
  assertContains(redactedText, "[REDACTED_DOB]");
});

test("does NOT redact plain words like 'April 15, 1990'", () => {
  // Verbal dates are intentionally left alone
  const { summary } = redactPII("She was born on April 15, 1990.");
  assertEqual(summary.dob, undefined);
});

// ---------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------

console.log("\nIP addresses");

test("redacts a valid IPv4 address", () => {
  const { redactedText } = redactPII("Client connected from 192.168.1.42.");
  assertNotContains(redactedText, "192.168.1.42");
  assertContains(redactedText, "[REDACTED_IP]");
});

test("does NOT redact an invalid octet sequence", () => {
  const { summary } = redactPII("Version 999.256.1.0 is invalid.");
  assertEqual(summary.ip_address, undefined);
});

// ---------------------------------------------------------------------------
// Bank account (keyword-anchored)
// ---------------------------------------------------------------------------

console.log("\nBank account numbers");

test("redacts account number after 'account' keyword", () => {
  const { redactedText } = redactPII("Transfer to account 12345678901234.");
  assertNotContains(redactedText, "12345678901234");
  assertContains(redactedText, "[REDACTED_BANK]");
});

test("redacts account number after 'acct' abbreviation", () => {
  const { redactedText } = redactPII("Acct: 987654321.");
  assertNotContains(redactedText, "987654321");
  assertContains(redactedText, "[REDACTED_BANK]");
});

test("does NOT redact a bare 10-digit number with no account keyword", () => {
  const { summary } = redactPII("Reference 1234567890.");
  assertEqual(summary.bank_account, undefined);
});

// ---------------------------------------------------------------------------
// Mixed PII
// ---------------------------------------------------------------------------

console.log("\nMixed PII in one string");

test("redacts multiple PII types in a single passage", () => {
  const input =
    "Patient Alice. Email: alice@clinic.com. DOB: 01/01/1985. " +
    "Phone: +1-800-555-0123. IP: 10.0.0.5.";
  const { redactedText, summary } = redactPII(input);

  assertNotContains(redactedText, "alice@clinic.com");
  assertNotContains(redactedText, "01/01/1985");
  assertNotContains(redactedText, "+1-800-555-0123");
  assertNotContains(redactedText, "10.0.0.5");
  assertEqual(summary.email, 1);
  assertEqual(summary.dob, 1);
  assertEqual(summary.phone_intl, 1);
  assertEqual(summary.ip_address, 1);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

console.log("\nEdge cases");

test("returns original when input is empty string", () => {
  const { redactedText, summary } = redactPII("");
  assertEqual(redactedText, "");
  assertEqual(Object.keys(summary).length, 0);
});

test("returns original when input is whitespace only", () => {
  const { redactedText } = redactPII("   ");
  assertEqual(redactedText, "   ");
});

test("handles non-string input gracefully", () => {
  const { redactedText } = redactPII(null);
  assertEqual(redactedText, null);
});

test("preserves surrounding text readability after redaction", () => {
  const { redactedText } = redactPII("Please call alice@example.com for the report.");
  assertEqual(
    redactedText,
    "Please call [REDACTED_EMAIL] for the report."
  );
});

// ---------------------------------------------------------------------------
// createRedactor factory
// ---------------------------------------------------------------------------

console.log("\ncreateRedactor factory");

test("disabled rules are skipped", () => {
  const redact = createRedactor({ disableRules: ["email"] });
  const { redactedText } = redact("Reach alice@example.com today.");
  assertContains(redactedText, "alice@example.com", "Email should not be redacted");
});

test("extra rules are applied", () => {
  const redact = createRedactor({
    extraRules: [
      {
        id: "employee_id",
        placeholder: "[REDACTED_EMP]",
        pattern: /\bEMP-\d{6}\b/g,
      },
    ],
  });
  const { redactedText, summary } = redact("Employee EMP-001234 filed the report.");
  assertNotContains(redactedText, "EMP-001234");
  assertContains(redactedText, "[REDACTED_EMP]");
  assertEqual(summary.employee_id, 1);
});

// ---------------------------------------------------------------------------
// formatRedactionSummary
// ---------------------------------------------------------------------------

console.log("\nformatRedactionSummary");

test("returns 'none' for empty summary", () => {
  assertEqual(formatRedactionSummary({}), "none");
});

test("formats single-count entry without multiplier", () => {
  assertEqual(formatRedactionSummary({ email: 1 }), "email");
});

test("formats multi-count entry with ×N", () => {
  assertEqual(formatRedactionSummary({ email: 3 }), "email×3");
});

test("formats mixed summary", () => {
  const result = formatRedactionSummary({ email: 1, phone_intl: 2 });
  assertContains(result, "email");
  assertContains(result, "phone_intl×2");
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
