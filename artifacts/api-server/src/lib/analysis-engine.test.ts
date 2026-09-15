import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test, { afterEach, before } from "node:test";
import { analysisSessionsTable, db } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { buildCountAnswer, deduplicateIncidents, incidentCitationError, type Incident } from "./analysis-engine";
import {
  createSession,
  CONTRACT_TEST_PROVENANCE,
  deleteSession,
  getSession,
  purgeExpiredArchivedSessions,
  purgeStaleContractFixtures,
  setSessionSources,
} from "./analysis-store";
import { getArchivedSessionSettings } from "./archived-session-settings";
import { parseBingNewsRss } from "./source-adapters";

function source(id: string, content: string, publishedAt = "2026-09-14T12:00:00Z") {
  return {
    id,
    title: "Border reporting",
    source: `Outlet ${id}`,
    sourceType: "NEWS" as const,
    publishedAt,
    relevance: 0.9,
    reliability: "MODERATE" as const,
    bluf: content,
    keyPoints: [],
    tags: [],
    url: `https://example.com/${id}`,
    content,
    contentDepth: "FULL_TEXT" as const,
  };
}

const question = "How many times did Country Alpha and Country Beta clash?";
const testRunId = crypto.randomUUID();
const testSessionIds = new Set<string>();

async function createTestSession(input: Parameters<typeof createSession>[0]) {
  const session = await createSession({
    ...input,
    provenance: CONTRACT_TEST_PROVENANCE,
    runId: testRunId,
  });
  testSessionIds.add(session.id);
  return session;
}

before(async () => {
  await purgeStaleContractFixtures(testRunId);
});

afterEach(async () => {
  const sessionIds = [...testSessionIds];
  testSessionIds.clear();
  await Promise.all(sessionIds.map((id) => deleteSession(id)));
});

test("does not create a count answer for a non-count assessment", () => {
  assert.equal(
    buildCountAnswer("Assess the implications of the border situation.", [
      source("a", "Country Alpha and Country Beta clashed on 12 September 2026."),
    ]),
    null,
  );
});

test("supports have-clashed count wording with cited results", () => {
  const answer = buildCountAnswer(
    "How many times have Country Alpha and Country Beta clashed?",
    [source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.")],
  );
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
});

test("supports subject-event-object count wording", () => {
  const answer = buildCountAnswer(
    "How many times did Country Alpha clash with Country Beta?",
    [source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.")],
  );
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
});

test("parses and applies a requested year separately from party names", () => {
  const answer = buildCountAnswer(
    "How many times did Country Alpha clash with Country Beta in 2025?",
    [
      source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2025."),
      source("b", "Country Alpha and Country Beta clashed at South Pass on 12 September 2026."),
    ],
  );
  assert.deepEqual(answer?.requestedParties, ["Country Alpha", "Country Beta"]);
  assert.deepEqual(answer?.dateRange, { startDate: "2025-01-01", endDate: "2025-12-31" });
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
});

test("live-shaped Bing excerpt flows from connector parsing into a cited count", () => {
  const xml = `<rss><channel><item>
    <title>Country Alpha and Country Beta clash at North Ridge</title>
    <link>https://www.bing.com/news/apiclick.aspx?id=example</link>
    <description>Officials reported that Country Alpha and Country Beta clashed at North Ridge on 12 September 2025, ending after a brief exchange of fire.</description>
    <pubDate>Sat, 13 Sep 2025 12:00:00 GMT</pubDate>
    <News:Source>Example News</News:Source>
  </item></channel></rss>`;
  const sources = parseBingNewsRss(xml, question, 5, "2025-09-13T12:00:00Z");
  assert.equal(sources[0]?.contentDepth, "EXCERPT");
  const answer = buildCountAnswer(question, sources);
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, [sources[0]?.id]);
});

test("supports count-between wording", () => {
  const answer = buildCountAnswer(
    "What is the number of clashes between Country Alpha and Country Beta?",
    [source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.")],
  );
  assert.equal(answer?.provisionalCount, 1);
});

const vocabularyCases = [
  {
    name: "fight and fought",
    question: "How many times did Country Alpha and Country Beta fight?",
    evidence: "Country Alpha and Country Beta fought at North Ridge on 12 September 2026.",
  },
];

for (const vocabularyCase of vocabularyCases) {
  test(`uses shared event vocabulary for ${vocabularyCase.name}`, () => {
    const answer = buildCountAnswer(
      vocabularyCase.question,
      [source("a", vocabularyCase.evidence)],
    );
    assert.equal(answer?.provisionalCount, 1);
    assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
  });
}

test("ambiguous party wording yields no count answer", () => {
  assert.equal(
    buildCountAnswer(
      "How many times did two countries clash?",
      [source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.")],
    ),
    null,
  );
});

test("generic incident questions are not treated as physical-clash counts", () => {
  assert.equal(
    buildCountAnswer(
      "How many incidents were there between Country Alpha and Country Beta?",
      [source("a", "Country Alpha and Country Beta had a diplomatic incident on 12 September 2026.")],
    ),
    null,
  );
});

test("a diplomatic incident does not satisfy a clash-count question", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta had a diplomatic incident on 12 September 2026."),
  ]);
  assert.equal(answer?.answerStatus, "INSUFFICIENT_EVIDENCE");
});

test("excludes reports that do not support both requested parties", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Gamma and Country Delta clashed on 12 September 2026."),
  ]);
  assert.equal(answer?.provisionalCount, 0);
});

test("does not borrow requested parties from adjacent context", () => {
  const answer = buildCountAnswer(question, [
    source(
      "a",
      "Country Alpha and Country Beta held talks. Country Gamma and Country Delta clashed at North Ridge on 12 September 2026.",
    ),
  ]);
  assert.equal(answer?.provisionalCount, 0);
});

test("does not treat a party mentioned as speaker as an event participant", () => {
  const answer = buildCountAnswer(question, [
    source(
      "a",
      "Country Alpha said Country Beta clashed with Country Gamma at North Ridge on 12 September 2026.",
    ),
  ]);
  assert.equal(answer?.answerStatus, "INSUFFICIENT_EVIDENCE");
});

test("excludes undated incidents rather than substituting publication time", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta clashed near North Ridge."),
  ]);
  assert.equal(answer?.provisionalCount, 0);
});

test("rejects negated and speculative event claims", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta did not clash at North Ridge on 12 September 2026."),
    source("b", "Country Alpha and Country Beta may clash at South Pass on 13 September 2026."),
  ]);
  assert.equal(answer?.answerStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(answer?.incidents.length, 0);
});

test("metadata-only discovery records do not produce a factual zero", () => {
  const metadataSource = {
    ...source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    contentDepth: "METADATA" as const,
  };
  const answer = buildCountAnswer(question, [metadataSource]);
  assert.equal(answer?.answerStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(answer?.incidents.length, 0);
});

test("a supporting headline with non-supporting content is not counted", () => {
  const headlineOnly = {
    ...source("a", "Officials met for scheduled talks on 12 September 2026."),
    title: "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026",
  };
  const answer = buildCountAnswer(question, [headlineOnly]);
  assert.equal(answer?.answerStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(answer?.incidents.length, 0);
});

test("extracts a supported incident from report content when the title is unrelated", () => {
  const contentOnly = {
    ...source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    title: "Daily regional briefing",
  };
  const answer = buildCountAnswer(question, [contentOnly]);
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
});

const reviewedIncident: Incident = {
  id: "reviewed",
  date: "2026-09-12T00:00:00.000Z",
  location: "North Ridge",
  parties: ["Country Alpha", "Country Beta"],
  description: "Country Alpha and Country Beta clashed at North Ridge.",
  sourceFileIds: ["a"],
  status: "INCLUDED",
};

test("finalization accepts selected evidence that supports the incident", () => {
  assert.equal(
    incidentCitationError(reviewedIncident, [
      source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    ]),
    null,
  );
});

test("finalization rejects unselected and metadata-only citations", () => {
  assert.match(incidentCitationError(reviewedIncident, []) ?? "", /selected evidence/);
  assert.match(
    incidentCitationError(reviewedIncident, [{
      ...source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
      contentDepth: "METADATA",
    }]) ?? "",
    /Metadata-only/,
  );
});

test("finalization rejects a citation that does not support the incident", () => {
  assert.match(
    incidentCitationError(reviewedIncident, [
      source("a", "Country Alpha and Country Beta clashed at South Pass on 12 September 2026."),
    ]) ?? "",
    /does not support/,
  );
});

test("provisional review rejects a description not supported by the citation", () => {
  const supportingSource = source(
    "a",
    "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026 after a patrol encounter.",
  );
  assert.match(
    incidentCitationError(
      { ...reviewedIncident, description: "The clash destroyed five aircraft and closed the airport." },
      [supportingSource],
      ["Country Alpha", "Country Beta"],
    ) ?? "",
    /does not support/,
  );
});

test("finalization rejects replaced or empty parties", () => {
  const supportingSource = source(
    "a",
    "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.",
  );
  assert.match(
    incidentCitationError(
      { ...reviewedIncident, parties: ["Country Gamma", "Country Delta"] },
      [supportingSource],
      ["Country Alpha", "Country Beta"],
    ) ?? "",
    /must match/,
  );
  assert.match(
    incidentCitationError(
      { ...reviewedIncident, parties: ["", "Country Beta"] },
      [supportingSource],
      ["Country Alpha", "Country Beta"],
    ) ?? "",
    /must match/,
  );
});

test("extracts multiple dated incidents from one report", () => {
  const answer = buildCountAnswer(question, [
    source(
      "a",
      "Country Alpha and Country Beta clashed near North Ridge on 10 September 2026. Country Alpha and Country Beta exchanged fire at South Pass on 13 September 2026.",
    ),
  ]);
  assert.equal(answer?.provisionalCount, 2);
});

test("keeps adjacent-day incidents at different locations distinct", () => {
  const answer = buildCountAnswer(question, [
    source(
      "a",
      "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026. Country Alpha and Country Beta clashed at South Pass on 13 September 2026.",
    ),
  ]);
  assert.equal(answer?.provisionalCount, 2);
});

test("keeps cross-source incidents with different stated event dates distinct", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    source("b", "Country Alpha and Country Beta clashed at North Ridge on 13 September 2026."),
  ]);
  assert.equal(answer?.provisionalCount, 2);
});

test("keeps same-day incidents at different known locations distinct", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    source("b", "Country Alpha and Country Beta clashed at South Pass on 12 September 2026."),
  ]);
  assert.equal(answer?.provisionalCount, 2);
});

test("consolidates matching reports when neither establishes a location", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta clashed on 12 September 2026 after patrols crossed paths."),
    source("b", "Country Alpha and Country Beta clashed on 12 September 2026 after patrols crossed paths."),
  ]);
  assert.equal(answer?.provisionalCount, 1);
  assert.equal(answer?.incidents[0]?.location, "Location not established");
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds.sort(), ["a", "b"]);
});

test("consolidates duplicate reports and preserves both citations", () => {
  const answer = buildCountAnswer(question, [
    source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
    source("b", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
  ]);
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds.sort(), ["a", "b"]);
});

test("repeated mentions in one source do not create duplicate citations", () => {
  const answer = buildCountAnswer(question, [
    source(
      "a",
      "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026. Country Alpha and Country Beta clashed at North Ridge on 12 September 2026.",
    ),
  ]);
  assert.equal(answer?.provisionalCount, 1);
  assert.deepEqual(answer?.incidents[0]?.sourceFileIds, ["a"]);
});

test("review updates cannot inflate the count with duplicate incidents", () => {
  const duplicate = {
    ...reviewedIncident,
    id: "duplicate",
    sourceFileIds: ["a"],
  };
  const normalized = deduplicateIncidents([reviewedIncident, duplicate]);
  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0]?.sourceFileIds, ["a"]);
});

async function withApi(
  run: (baseUrl: string) => Promise<void>,
) {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function requestJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json() as Record<string, any>;
  return { response, body };
}

async function createCountSession() {
  const session = await createTestSession({ prompt: question });
  return (await setSessionSources(session.id, [
    {
      ...source("a", "Country Alpha and Country Beta clashed at North Ridge on 12 September 2026."),
      retrievedAt: "2026-09-14T12:00:00Z",
      collectionMethod: "TEST_FIXTURE",
    },
    {
      ...source("b", "Country Alpha and Country Beta clashed at South Pass on 13 September 2026."),
      retrievedAt: "2026-09-14T12:00:00Z",
      collectionMethod: "TEST_FIXTURE",
    },
  ]))!;
}

test("API review contract supports exclude, include, add, save, and finalize", async () => {
  await withApi(async (baseUrl) => {
    const session = await createCountSession();
    const assessed = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "POST",
        body: JSON.stringify({ selectedSourceFileIds: ["a", "b"] }),
      },
    );
    assert.equal(assessed.response.status, 200);
    assert.equal(assessed.body.assessment.countAnswer.provisionalCount, 2);

    const [first, second] = assessed.body.assessment.countAnswer.incidents;
    const excluded = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [{ ...first, status: "EXCLUDED" }],
          finalized: false,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(excluded.response.status, 200);
    assert.equal(excluded.body.assessment.countAnswer.provisionalCount, 0);
    assert.equal(excluded.body.assessment.countAnswer.answerStatus, "INSUFFICIENT_EVIDENCE");

    const includedAndAdded = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [
            { ...first, status: "INCLUDED" },
            { ...second, id: "analyst-added", status: "INCLUDED" },
          ],
          finalized: false,
          expectedVersion: excluded.body.version,
        }),
      },
    );
    assert.equal(includedAndAdded.response.status, 200);
    assert.equal(includedAndAdded.body.assessment.countAnswer.provisionalCount, 2);
    assert.equal(includedAndAdded.body.assessment.countAnswer.finalized, false);

    const saved = await requestJson(baseUrl, `/analysis-sessions/${session.id}`);
    assert.equal(saved.response.status, 200);
    assert.deepEqual(
      saved.body.assessment.countAnswer.incidents.map((incident: Incident) => incident.id),
      [first.id, "analyst-added"],
    );

    const finalized = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: saved.body.assessment.countAnswer.incidents,
          finalized: true,
          expectedVersion: saved.body.version,
        }),
      },
    );
    assert.equal(finalized.response.status, 200);
    assert.equal(finalized.body.assessment.countAnswer.finalized, true);
    assert.equal(finalized.body.assessment.provisional, false);
    assert.equal((await getSession(session.id))?.assessment?.countAnswer?.finalized, true);
  });
});

test("API review contract rejects dropped citations and finalized factual zero", async () => {
  await withApi(async (baseUrl) => {
    const session = await createCountSession();
    const assessed = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "POST",
        body: JSON.stringify({ selectedSourceFileIds: ["a"] }),
      },
    );
    const incident = assessed.body.assessment.countAnswer.incidents[0];

    const missingCitation = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [{ ...incident, sourceFileIds: [] }],
          finalized: false,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(missingCitation.response.status, 400);
    assert.match(missingCitation.body.error, /requires a citation/);

    const factualZero = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [{ ...incident, status: "EXCLUDED" }],
          finalized: true,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(factualZero.response.status, 400);
    assert.match(factualZero.body.error, /factual zero/);
  });
});

test("API review contract rejects a stale concurrent update", async () => {
  await withApi(async (baseUrl) => {
    const session = await createCountSession();
    const assessed = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "POST",
        body: JSON.stringify({ selectedSourceFileIds: ["a"] }),
      },
    );
    const incident = assessed.body.assessment.countAnswer.incidents[0];
    const firstUpdate = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [incident],
          finalized: false,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(firstUpdate.response.status, 200);

    const staleUpdate = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: [{ ...incident, status: "EXCLUDED" }],
          finalized: false,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(staleUpdate.response.status, 409);
    assert.match(staleUpdate.body.error, /Reload before saving/);

    const persisted = await getSession(session.id);
    assert.equal(persisted?.version, firstUpdate.body.version);
    assert.equal(persisted?.assessment?.countAnswer?.incidents[0]?.status, "INCLUDED");
  });
});

test("archived sessions are hidden by default and can be restored", async () => {
  await withApi(async (baseUrl) => {
    const session = await createTestSession({ prompt: "Archive this obsolete draft session" });
    const archived = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          archived: true,
          expectedVersion: session.version,
        }),
      },
    );
    assert.equal(archived.response.status, 200);
    assert.equal(typeof archived.body.archivedAt, "string");

    const visible = await requestJson(baseUrl, "/analysis-sessions");
    assert.equal(
      visible.body.some((candidate: { id: string }) => candidate.id === session.id),
      false,
    );

    const includingArchived = await requestJson(
      baseUrl,
      "/analysis-sessions?includeArchived=true",
    );
    assert.equal(
      includingArchived.body.some(
        (candidate: { id: string }) => candidate.id === session.id,
      ),
      true,
    );

    const restored = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          archived: false,
          expectedVersion: archived.body.version,
        }),
      },
    );
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.archivedAt, null);
  });
});

test("finalized reviews cannot be archived", async () => {
  await withApi(async (baseUrl) => {
    const session = await createCountSession();
    const assessed = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "POST",
        body: JSON.stringify({ selectedSourceFileIds: ["a"] }),
      },
    );
    const finalized = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}/assessment`,
      {
        method: "PATCH",
        body: JSON.stringify({
          incidents: assessed.body.assessment.countAnswer.incidents,
          finalized: true,
          expectedVersion: assessed.body.version,
        }),
      },
    );
    assert.equal(finalized.response.status, 200);

    const archive = await requestJson(
      baseUrl,
      `/analysis-sessions/${session.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          archived: true,
          expectedVersion: finalized.body.version,
        }),
      },
    );
    assert.equal(archive.response.status, 409);
    assert.match(archive.body.error, /Finalized/);
  });
});

test("retention removes only expired archived non-finalized sessions", async () => {
  const expiredDraft = await createTestSession({
    prompt: "Expire this archived test session",
  });
  const expiredFinalized = await createTestSession({
    prompt: "Retain this finalized archived test session",
  });
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await db
    .update(analysisSessionsTable)
    .set({ archivedAt: expiredAt })
    .where(eq(analysisSessionsTable.id, expiredDraft.id));
  await db
    .update(analysisSessionsTable)
    .set({ archivedAt: expiredAt, finalizedAt: expiredAt })
    .where(eq(analysisSessionsTable.id, expiredFinalized.id));

  await purgeExpiredArchivedSessions();

  assert.equal(await getSession(expiredDraft.id), undefined);
  assert.notEqual(await getSession(expiredFinalized.id), undefined);
});

test("archived session settings use documented defaults", () => {
  assert.deepEqual(getArchivedSessionSettings({}), {
    retentionDays: 30,
    cleanupIntervalMs: 6 * 60 * 60 * 1000,
  });
});

test("configured retention controls the archive cutoff", async () => {
  const retained = await createTestSession({
    prompt: "Retain this archive inside the configured window",
  });
  const expired = await createTestSession({
    prompt: "Expire this archive outside the configured window",
  });
  const now = new Date("2026-09-15T12:00:00.000Z");
  await db
    .update(analysisSessionsTable)
    .set({ archivedAt: new Date("2026-09-13T12:00:00.000Z") })
    .where(eq(analysisSessionsTable.id, retained.id));
  await db
    .update(analysisSessionsTable)
    .set({ archivedAt: new Date("2026-09-11T12:00:00.000Z") })
    .where(eq(analysisSessionsTable.id, expired.id));

  const previousRetention = process.env["ARCHIVED_SESSION_RETENTION_DAYS"];
  process.env["ARCHIVED_SESSION_RETENTION_DAYS"] = "3";
  try {
    await purgeExpiredArchivedSessions(now);
  } finally {
    if (previousRetention === undefined) {
      delete process.env["ARCHIVED_SESSION_RETENTION_DAYS"];
    } else {
      process.env["ARCHIVED_SESSION_RETENTION_DAYS"] = previousRetention;
    }
  }

  assert.notEqual(await getSession(retained.id), undefined);
  assert.equal(await getSession(expired.id), undefined);
});

test("invalid archived session settings fail clearly", () => {
  assert.throws(
    () =>
      getArchivedSessionSettings({
        ARCHIVED_SESSION_RETENTION_DAYS: "never",
      }),
    /Invalid ARCHIVED_SESSION_RETENTION_DAYS.*positive number/,
  );
  assert.throws(
    () =>
      getArchivedSessionSettings({
        ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES: "999999",
      }),
    /Invalid ARCHIVED_SESSION_CLEANUP_INTERVAL_MINUTES.*at most/,
  );
});

test("test cleanup deletes only the session with the exact fixture ID", async () => {
  const fixture = await createTestSession({ prompt: "Delete only this contract fixture" });
  const neighboringSession = await createTestSession({ prompt: "Keep this neighboring session" });

  assert.equal(await deleteSession(fixture.id), true);
  assert.equal(await getSession(fixture.id), undefined);
  assert.notEqual(await getSession(neighboringSession.id), undefined);
});

test("stale fixture sweep preserves active runs and analyst-created sessions", async () => {
  const staleFixture = await createSession({
    prompt: "Remove this stale contract fixture",
    provenance: CONTRACT_TEST_PROVENANCE,
    runId: "stale-contract-run",
  });
  const activeFixture = await createTestSession({
    prompt: "Keep this active contract fixture",
  });
  const analystSession = await createSession({
    prompt: "Keep this analyst-created session",
  });
  testSessionIds.add(staleFixture.id);
  testSessionIds.add(analystSession.id);
  const oldCreatedAt = new Date("2026-09-15T08:00:00.000Z");
  await db
    .update(analysisSessionsTable)
    .set({ createdAt: oldCreatedAt })
    .where(inArray(analysisSessionsTable.id, [
      staleFixture.id,
      analystSession.id,
    ]));

  await purgeStaleContractFixtures(
    testRunId,
    new Date("2026-09-15T12:00:00.000Z"),
  );
  assert.equal(await getSession(staleFixture.id), undefined);
  assert.notEqual(await getSession(activeFixture.id), undefined);
  assert.notEqual(await getSession(analystSession.id), undefined);
});
