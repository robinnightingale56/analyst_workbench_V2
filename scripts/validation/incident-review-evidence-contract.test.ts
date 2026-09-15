import assert from "node:assert/strict";

import { UpdateIncidentReviewBody } from "../../lib/api-zod/src/generated/api";

const evidenceSpan = {
  sourceFileId: "source-1",
  text: "Country Alpha and Country Beta clashed on 12 September 2026.",
  startChar: 14,
  endChar: 77,
};
const parsed = UpdateIncidentReviewBody.parse({
  expectedVersion: 4,
  finalized: true,
  incidents: [{
    id: "incident-1",
    date: "2026-09-12T00:00:00Z",
    location: "North Ridge",
    parties: ["Country Alpha", "Country Beta"],
    description: evidenceSpan.text,
    sourceFileIds: [evidenceSpan.sourceFileId],
    evidenceSpans: [evidenceSpan],
    status: "INCLUDED",
  }],
});

assert.deepEqual(
  parsed.incidents[0].evidenceSpans,
  [evidenceSpan],
  "Generated incident-review validation stripped exact evidence spans",
);

console.log("Generated review contract preserves exact evidence spans.");