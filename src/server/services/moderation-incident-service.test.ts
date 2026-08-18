import assert from "node:assert/strict";
import test from "node:test";
import { incidentSeverityFor } from "./moderation-incident-rules";

test("incident severity grows with repeated violations", () => {
  assert.equal(incidentSeverityFor("UNKNOWN", 0), "LOW");
  assert.equal(incidentSeverityFor("LINK", 0), "MEDIUM");
  assert.equal(incidentSeverityFor("SPAM", 0), "HIGH");
  assert.equal(incidentSeverityFor("LINK", 2), "HIGH");
  assert.equal(incidentSeverityFor("LINK", 5), "CRITICAL");
});
