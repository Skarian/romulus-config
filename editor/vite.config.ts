import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { EditorBackend, ensureLocalArtifacts } from "./src/server/backend";
import type { NormalizedScope, SourceFilesRequest } from "./src/types";

const VIRTUAL_ID = "virtual:romulus-editor-state";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const editorRoot = fileURLToPath(new URL(".", import.meta.url));

function editorStatePlugin(): Plugin {
  let repoRoot = "";
  let sourcePath = "";
  let schemaPath = "";
  let backend: EditorBackend;

  return {
    name: "romulus-editor-state",
    configResolved(config) {
      repoRoot = path.resolve(config.root, "..");
      sourcePath = path.join(repoRoot, "source.json");
      schemaPath = path.join(repoRoot, "references/romulus/docs/schema.json");
      ensureLocalArtifacts(repoRoot);
      const env = loadEnv(config.mode, config.root, "");
      backend = new EditorBackend(repoRoot, env.REAL_DEBRID_API_KEY ?? "");
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
      server.middlewares.use("/__editor/state", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(backend.buildState()));
      });
      server.middlewares.use("/__editor/source-files", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedRequest = parseSourceFilesRequest(
          rawBody.trim().length === 0 ? null : JSON.parse(rawBody),
        );
        if (!parsedRequest) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Invalid source files payload" }));
          return;
        }

        try {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(backend.getSourceFiles(parsedRequest)));
        } catch (error) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Source files could not be loaded",
            }),
          );
        }
      });
      server.middlewares.use("/__editor/hydrate", async (request, response) => {
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
      server.middlewares.use("/__editor/preview-fixtures", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          hydrationKey?: string;
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
          !parsedBody.hydrationKey ||
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
          const fixture = backend.setPreviewFixture(parsedBody.hydrationKey, {
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
      server.middlewares.use("/__editor/archive-sample-extensions", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          selectionStateKey?: string;
          unarchiveEnabled?: boolean;
          fileExtensions?: string[];
        };
        if (
          !parsedBody.selectionStateKey ||
          typeof parsedBody.unarchiveEnabled !== "boolean" ||
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
            {
              selectionStateKey: parsedBody.selectionStateKey,
              unarchiveEnabled: parsedBody.unarchiveEnabled,
            },
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
      server.middlewares.use("/__editor/selected-files", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsedBody = JSON.parse(rawBody) as {
          source?: SourceFilesRequest;
          selectedRowIds?: string[];
        };
        const parsedRequest = parseSourceFilesRequest(parsedBody.source);
        if (!parsedRequest || !Array.isArray(parsedBody.selectedRowIds)) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Invalid selected files payload" }));
          return;
        }

        try {
          const selectedRowIds = backend.setSelectedRowIds(
            parsedRequest,
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
      server.middlewares.use("/__editor/save-document", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        try {
          const rawBody = await readRequestBody(request);
          const parsedBody = JSON.parse(rawBody) as {
            preview?: {
              checksum?: string;
              text?: string;
            };
          };
          if (
            !parsedBody.preview ||
            typeof parsedBody.preview.checksum !== "string" ||
            typeof parsedBody.preview.text !== "string"
          ) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Invalid source.json save payload" }));
            return;
          }

          backend.saveDocumentPreview(parsedBody.preview);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ saved: true }));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "source.json could not be saved",
            }),
          );
        }
      });
      server.middlewares.use("/__editor/clear-data", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }

        try {
          const rawBody = await readRequestBody(request);
          const parsedBody = JSON.parse(rawBody) as {
            selection?: {
              fileCache?: boolean;
              savedSelections?: boolean;
              savedPreviewData?: boolean;
              updateLogs?: boolean;
            };
          };
          const selection = parsedBody.selection;
          if (
            !selection ||
            typeof selection.fileCache !== "boolean" ||
            typeof selection.savedSelections !== "boolean" ||
            typeof selection.savedPreviewData !== "boolean" ||
            typeof selection.updateLogs !== "boolean"
          ) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Invalid clear data payload" }));
            return;
          }

          const result = backend.clearLocalData(selection);
          response.statusCode = 200;
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
                  : "Local database data could not be cleared",
            }),
          );
        }
      });
      server.middlewares.use("/__editor/events", (_request, response) => {
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
  root: editorRoot,
  plugins: [react(), editorStatePlugin()],
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

function parseSourceFilesRequest(value: unknown): SourceFilesRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.hydrationKey !== "string" ||
    typeof candidate.selectionStateKey !== "string" ||
    !isNormalizedScope(candidate.scope) ||
    !Array.isArray(candidate.ignoreGlobs) ||
    candidate.ignoreGlobs.some((glob) => typeof glob !== "string")
  ) {
    return null;
  }

  return {
    hydrationKey: candidate.hydrationKey,
    selectionStateKey: candidate.selectionStateKey,
    legacyEntryId:
      typeof candidate.legacyEntryId === "string" ? candidate.legacyEntryId : undefined,
    scope: candidate.scope,
    ignoreGlobs: candidate.ignoreGlobs,
  };
}

function isNormalizedScope(value: unknown): value is NormalizedScope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.normalizedPath === "string" &&
    typeof candidate.includeNestedFiles === "boolean" &&
    typeof candidate.isArchiveSelection === "boolean"
  );
}
