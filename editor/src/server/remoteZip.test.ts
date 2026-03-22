import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { enumerateRemoteZip } from "./remoteZip";

test("enumerateRemoteZip reads archive entries over range requests", async () => {
  const archiveBuffer = createStoredZip([
    { name: "folder/Metroid.nes", data: Buffer.from("metroid") },
    { name: "folder/readme.txt", data: Buffer.from("notes") },
  ]);

  const server = http.createServer((request, response) => {
    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(archiveBuffer.length));
      response.end();
      return;
    }

    const rangeHeader = request.headers.range;
    if (!rangeHeader) {
      response.statusCode = 400;
      response.end("Range header required");
      return;
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      response.statusCode = 400;
      response.end("Invalid range");
      return;
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const chunk = archiveBuffer.subarray(start, end + 1);
    response.statusCode = 206;
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Range",
      `bytes ${start}-${end}/${archiveBuffer.length}`,
    );
    response.setHeader("Content-Length", String(chunk.length));
    response.end(chunk);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  after(() => {
    server.close();
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address was unavailable");
  }

  const entries = await enumerateRemoteZip(
    `http://127.0.0.1:${address.port}/archive.zip`,
  );

  assert.deepEqual(
    entries.map((entry) => entry.entryPath),
    ["folder/Metroid.nes", "folder/readme.txt"],
  );
});

test("enumerateRemoteZip tolerates oversized 206 bodies when the requested range starts correctly", async () => {
  const archiveBuffer = createStoredZip([
    { name: "folder/Metroid.nes", data: Buffer.from("metroid") },
    { name: "folder/readme.txt", data: Buffer.from("notes") },
  ]);

  const server = http.createServer((request, response) => {
    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(archiveBuffer.length));
      response.end();
      return;
    }

    const rangeHeader = request.headers.range;
    if (!rangeHeader) {
      response.statusCode = 400;
      response.end("Range header required");
      return;
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      response.statusCode = 400;
      response.end("Invalid range");
      return;
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    const oversizedChunk = archiveBuffer.subarray(start);
    response.statusCode = 206;
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Range",
      `bytes ${start}-${end}/${archiveBuffer.length}`,
    );
    response.setHeader("Content-Length", String(oversizedChunk.length));
    response.end(oversizedChunk);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  after(() => {
    server.close();
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address was unavailable");
  }

  const entries = await enumerateRemoteZip(
    `http://127.0.0.1:${address.port}/archive.zip`,
  );

  assert.deepEqual(
    entries.map((entry) => entry.entryPath),
    ["folder/Metroid.nes", "folder/readme.txt"],
  );
});

function createStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, "utf8");
    const fileData = entry.data;
    const crc32 = crc32Buffer(fileData);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(fileData.length, 18);
    localHeader.writeUInt32LE(fileData.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(fileData.length, 20);
    centralHeader.writeUInt32LE(fileData.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, fileName, fileData);
    centralParts.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + fileData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

const CRC32_TABLE = createCrc32Table();

function crc32Buffer(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table(): number[] {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
}
