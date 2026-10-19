import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeFeedbackDiagnosticText } from "../src/features/feedback/feedback-diagnostics";

test("Report an error without sharing credentials, personal identifiers or private URL parameters", () => {
  const report = sanitizeFeedbackDiagnosticText(
    "Bearer secret.token access_token=abc123 password=hunter2 user@example.com " +
    "550e8400-e29b-41d4-a716-446655440000 https://soundspin.example/room/demo?invite=private#player"
  );
  for (const secret of ["secret.token", "abc123", "hunter2", "user@example.com", "550e8400-e29b-41d4-a716-446655440000", "invite=private", "#player"]) {
    assert.equal(report.includes(secret), false, secret);
  }
  assert.ok(report.includes("https://soundspin.example/room/demo"));
});
