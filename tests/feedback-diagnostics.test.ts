import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeFeedbackDiagnosticText } from "../src/feedback-diagnostics";

test("feedback diagnostics redact credentials and personal identifiers", () => {
  const sanitized = sanitizeFeedbackDiagnosticText(
    "Bearer secret.token access_token=abc123 password=hunter2 user@example.com 550e8400-e29b-41d4-a716-446655440000"
  );

  assert.equal(
    sanitized,
    "Bearer [redacted] access_token=[redacted] password=[redacted] [redacted-email] [redacted-id]"
  );
});

test("feedback diagnostics strip URL query strings and fragments", () => {
  const sanitized = sanitizeFeedbackDiagnosticText(
    "Request failed at https://soundspin.example/room/demo?invite=secret#player"
  );

  assert.equal(sanitized, "Request failed at https://soundspin.example/room/demo");
});

test("feedback diagnostics cap error text length", () => {
  assert.equal(sanitizeFeedbackDiagnosticText("x".repeat(300)).length, 240);
});
