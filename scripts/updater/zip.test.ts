import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZipEntries } from "./zip";

/** 無圧縮（0）か Deflate（8）の ZIP を組み立てる（テスト用。CRC は読む側で見ないので 0）。 */
function buildZip(files: { name: string; data: Buffer; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.method === 8 ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(f.method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(f.method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("readZipEntries", () => {
  it("無圧縮と Deflate の両方を読み、ディレクトリは飛ばす", () => {
    const zip = buildZip([
      { name: "dir/", data: Buffer.alloc(0), method: 0 },
      { name: "dir/a.txt", data: Buffer.from("stored 保有"), method: 0 },
      { name: "b.csv", data: Buffer.from("x".repeat(1000)), method: 8 },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["dir/a.txt", "b.csv"]);
    expect(entries[0].data.toString("utf8")).toBe("stored 保有");
    expect(entries[1].data.toString("utf8")).toBe("x".repeat(1000));
  });

  it("途中で切れた ZIP は例外", () => {
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("hello"), method: 0 }]);
    const broken = Buffer.concat([zip.subarray(0, 32), zip.subarray(zip.length - 60)]);
    expect(() => readZipEntries(broken)).toThrow();
  });
});
