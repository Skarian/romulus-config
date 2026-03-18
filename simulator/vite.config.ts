import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { SimulatorBackend, ensureLocalArtifacts } from "./src/server/backend";

const VIRTUAL_ID = "virtual:romulus-simulator-state";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const simulatorRoot = fileURLToPath(new URL(".", import.meta.url));

function simulatorStatePlugin(): Plugin {
  let repoRoot = "";
  let sourcePath = "";
  let schemaPath = "";
  let backend: SimulatorBackend;

  return {
    name: "romulus-simulator-state",
    configResolved(config) {
      repoRoot = path.resolve(config.root, "..");
      sourcePath = path.join(repoRoot, "source.json");
      schemaPath = path.join(repoRoot, "references/romulus/docs/schema.json");
      ensureLocalArtifacts(repoRoot);
      const env = loadEnv(config.mode, config.root, "");
      backend = new SimulatorBackend(repoRoot, env.REAL_DEBRID_API_KEY ?? "");
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return null;
      }

      const state = backend.buildState();
      return `export default ${JSON.stringify(state)};`;
    },
    configureServer(server) {
      server.watcher.add([sourcePath, schemaPath]);
      server.middlewares.use("/__simulator/state", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(backend.buildState()));
      });
      server.middlewares.use("/__simulator/source-files", (request, response) => {
        const url = new URL(request.url ?? "", "http://127.0.0.1");
        const entryId = url.searchParams.get("entryId");
        if (!entryId) {
          response.statusCode = 400;
          response.end("entryId is required");
          return;
        }

        try {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(backend.getSourceFiles(entryId)));
        } catch (error) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown source entry",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/hydrate", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody =
          rawBody.trim().length === 0
            ? {}
            : (JSON.parse(rawBody) as { entryIds?: string[]; forceRefresh?: boolean });
        try {
          const hydrationRun = backend.runHydration(parsedBody.entryIds, {
            forceRefresh: parsedBody.forceRefresh ?? false,
          });
          void hydrationRun.catch(() => {});
          response.statusCode = 202;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ accepted: true }));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Hydration could not start",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/preview-fixtures", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          entryId?: string;
          fixtureKey?: string;
          sourceFileId?: string | null;
          archiveDisplayName?: string;
          archiveBaseName?: string;
          samples?: Array<{
            id: string;
            originalName: string;
            relativeDirectory: string;
            outputNameOverride?: string | null;
          }>;
        };
        if (
          !parsedBody.entryId ||
          !parsedBody.archiveDisplayName ||
          !parsedBody.archiveBaseName ||
          !Array.isArray(parsedBody.samples)
        ) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Invalid preview fixture payload" }));
          return;
        }

        try {
          const fixture = backend.setPreviewFixture(parsedBody.entryId, {
            fixtureKey: parsedBody.fixtureKey,
            sourceFileId: parsedBody.sourceFileId ?? null,
            archiveDisplayName: parsedBody.archiveDisplayName,
            archiveBaseName: parsedBody.archiveBaseName,
            samples: parsedBody.samples.map((sample) => ({
              id: sample.id,
              originalName: sample.originalName,
              relativeDirectory: sample.relativeDirectory,
              outputNameOverride: sample.outputNameOverride ?? null,
            })),
          });
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(fixture));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Preview fixture could not be saved",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/archive-sample-extensions", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          entryId?: string;
          fileExtensions?: string[];
        };
        if (
          !parsedBody.entryId ||
          !Array.isArray(parsedBody.fileExtensions) ||
          parsedBody.fileExtensions.some((value) => typeof value !== "string")
        ) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Invalid archive sample extensions payload" }));
          return;
        }

        try {
          const policy = backend.setArchiveSampleExtensions(
            parsedBody.entryId,
            parsedBody.fileExtensions,
          );
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(policy));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Archive sample extensions could not be saved",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/selected-files", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          entryId?: string;
          selectedRowIds?: string[];
        };
        if (!parsedBody.entryId || !Array.isArray(parsedBody.selectedRowIds)) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Invalid selected files payload" }));
          return;
        }

        try {
          const selectedRowIds = backend.setSelectedRowIds(
            parsedBody.entryId,
            parsedBody.selectedRowIds,
          );
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ selectedRowIds }));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Selected files could not be saved",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/source-entry-policy", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        try {
          const rawBody = await readRequestBody(request);
          const parsedBody = JSON.parse(rawBody) as {
            entryId?: string;
            selectionStateKey?: string;
            displayName?: string;
            subfolder?: string;
            renamePolicy?: {
              mode?: "none" | "all" | "phrases";
              phrases?: string[];
            };
            ignoreGlobs?: string[];
            confirmReplaceCustomRename?: unknown;
          };

          if (
            !parsedBody.entryId ||
            !parsedBody.selectionStateKey ||
            !parsedBody.displayName ||
            !parsedBody.subfolder ||
            (!parsedBody.renamePolicy && !Array.isArray(parsedBody.ignoreGlobs)) ||
            (parsedBody.renamePolicy &&
              (!parsedBody.renamePolicy.mode ||
                !Array.isArray(parsedBody.renamePolicy.phrases)))
          ) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Invalid source entry policy payload" }));
            return;
          }

          const result = backend.updateSourceEntryPolicy({
            entryId: parsedBody.entryId,
            selectionStateKey: parsedBody.selectionStateKey,
            displayName: parsedBody.displayName,
            subfolder: parsedBody.subfolder,
            renamePolicy: parsedBody.renamePolicy
              ? {
                  mode: parsedBody.renamePolicy.mode,
                  phrases: parsedBody.renamePolicy.phrases,
                }
              : undefined,
            ignoreGlobs: Array.isArray(parsedBody.ignoreGlobs)
              ? parsedBody.ignoreGlobs
              : undefined,
            confirmReplaceCustomRename:
              typeof parsedBody.confirmReplaceCustomRename === "undefined"
                ? false
                : parsedBody.confirmReplaceCustomRename,
          });
          response.statusCode = result.status === "ok" ? 200 : 409;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(result));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Source entry policies could not be saved",
            }),
          );
        }
      });
      server.middlewares.use("/__simulator/events", (_request, response) => {
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.write("event: state\n");
        response.write("data: {}\n\n");
        const unsubscribe = backend.subscribe((event) => {
          response.write(`event: ${event.type}\n`);
          response.write("data: {}\n\n");
        });
        response.on("close", () => {
          unsubscribe();
          response.end();
        });
      });
    },
    handleHotUpdate(context) {
      if (context.file !== sourcePath && context.file !== schemaPath) {
        return;
      }

      const module = context.server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
      if (module) {
        context.server.moduleGraph.invalidateModule(module);
      }
      backend.publishConfigUpdated();
    },
  };
}

export default defineConfig({
  root: simulatorRoot,
  plugins: [react(), simulatorStatePlugin()],
  server: {
    open: false,
  },
});

function readRequestBody(
  request: Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"] extends (
    ...args: infer _Args
  ) => void
    ? NodeJS.ReadableStream
    : NodeJS.ReadableStream,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}
