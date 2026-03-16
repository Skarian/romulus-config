import test from "node:test";
import assert from "node:assert/strict";

import {
  REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS,
  RealDebridClient,
  REAL_DEBRID_INTER_REQUEST_DELAY_MS,
} from "./realDebrid";

test("startExactZipAcquisition reuses the matched torrent, accepts empty-body selectFiles, and paces requests", async () => {
  let nowMs = 0;
  const sleeps: number[] = [];
  const requests: Array<{ url: string; method: string; atMs: number }> = [];
  const logs: string[] = [];
  const fetchImpl = queuedFetch(requests, [
    jsonResponse([{ host: "rd" }]),
    jsonResponse({ id: "torrent-1" }),
    jsonResponse(torrentInfo({
      selected: 0,
      links: [],
    })),
    new Response(null, { status: 204 }),
    jsonResponse(torrentInfo({
      selected: 1,
      links: [],
    })),
    jsonResponse(torrentInfo({
      selected: 1,
      links: ["https://restricted.example/link"],
    })),
  ], () => nowMs);

  const client = new RealDebridClient("token", {
    fetchImpl,
    now: () => nowMs,
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      nowMs += durationMs;
    },
    onLog: (message) => {
      logs.push(message);
    },
  });

  const result = await client.startExactZipAcquisition(
    [
      {
        magnetUri: "magnet:?xt=urn:btih:AAA",
        partLabel: null,
      },
    ],
    "/ROMs/Nintendo.zip",
  );

  assert.equal(result.exactMatch.path, "/ROMs/Nintendo.zip");
  assert.equal(result.exactMatch.locator.torrentId, "torrent-1");
  assert.equal(result.status.kind, "links-ready");
  assert.deepEqual(
    result.status.readyLinks,
    [{ restrictedUrl: "https://restricted.example/link" }],
  );
  assert.deepEqual(
    requests.map((request) => request.atMs),
    [
      0,
      1_000,
      2_000,
      3_000,
      4_000,
      5_000,
    ],
  );
  assert.deepEqual(
    sleeps,
    Array(5).fill(REAL_DEBRID_INTER_REQUEST_DELAY_MS),
  );
  assert.ok(logs.length > 0);
  assert.equal(
    logs.some((message) => /rate limited/i.test(message)),
    false,
  );
});

test("enumerateProviderFiles retries 429 responses with a fallback cooldown", async () => {
  let nowMs = 0;
  const sleeps: number[] = [];
  const requests: Array<{ url: string; method: string; atMs: number }> = [];
  const logs: string[] = [];

  const fetchImpl = queuedFetch(requests, [
    jsonResponse({ error: "too_many_requests" }, {
      status: 429,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    jsonResponse([{ host: "rd" }]),
    jsonResponse({ id: "torrent-1" }),
    jsonResponse(torrentInfo({
      selected: 0,
      links: [],
    })),
    new Response(null, { status: 204 }),
  ], () => nowMs);

  const client = new RealDebridClient("token", {
    fetchImpl,
    now: () => nowMs,
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      nowMs += durationMs;
    },
    onLog: (message) => {
      logs.push(message);
    },
  });

  const files = await client.enumerateProviderFiles([
    {
      magnetUri: "magnet:?xt=urn:btih:AAA",
      partLabel: null,
    },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].path, "/ROMs/Nintendo.zip");
  assert.deepEqual(
    requests.map((request) => request.atMs),
    [
      0,
      5_000,
      6_000,
      7_000,
      8_000,
    ],
  );
  assert.deepEqual(sleeps, [5_000, 1_000, 1_000, 1_000]);
  assert.equal(
    logs.some((message) => /fallback cooldown/i.test(message)),
    true,
  );
});

test("cooldownBetweenSources waits two seconds and logs the source boundary cooldown", async () => {
  let nowMs = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const client = new RealDebridClient("token", {
    now: () => nowMs,
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      nowMs += durationMs;
    },
    onLog: (message) => {
      logs.push(message);
    },
  });

  await client.cooldownBetweenSources();

  assert.deepEqual(sleeps, [REAL_DEBRID_BETWEEN_SOURCE_DELAY_MS]);
  assert.match(logs[0] ?? "", /before the next source/i);
});

function queuedFetch(
  requests: Array<{ url: string; method: string; atMs: number }>,
  responses: Response[],
  now: () => number,
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requests.push({
      url,
      method: init?.method ?? "GET",
      atMs: now(),
    });

    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch request: ${init?.method ?? "GET"} ${url}`);
    }
    return next;
  };
}

function jsonResponse(
  payload: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

function torrentInfo(input: {
  selected: number;
  links: string[];
}) {
  return {
    id: "torrent-1",
    status: "downloaded",
    progress: 100,
    files: [
      {
        id: 7,
        path: "/ROMs/Nintendo.zip",
        bytes: 123,
        selected: input.selected,
      },
    ],
    links: input.links,
  };
}
