import { inflateRawSync } from "node:zlib";

// ZIP の中身を読む最小の実装（Node 標準の zlib だけを使い、依存を増やさない）。
// EDINET の CSV（type=5）とコードリスト（Edinetcode.zip）で使う。
// 対応: 無圧縮（method 0）と Deflate（method 8）。ZIP64・暗号化・分割は非対応（EDINET の ZIP では使われていない）。
// サイズは中央ディレクトリの値を使う（ローカルヘッダのサイズはデータ記述子つきだと 0 のことがあるため）。

export interface ZipEntry {
  /** アーカイブ内のパス（例 "XBRL_TO_CSV/jplvh010000-lvh-001_....csv"） */
  name: string;
  data: Buffer;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD は末尾 22 バイト＋コメント（最大 65535 バイト）の中にある
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error("ZIP の終端レコードが見つからない");
}

/** ZIP のファイル（ディレクトリを除く）を全部読む。壊れていれば例外。 */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error("ZIP として短すぎる");
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error("ZIP の中央ディレクトリが壊れている");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    // bit 11 が立っていれば名前は UTF-8。そうでなければ ASCII 前提で latin1 として読む
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (flags & 0x1) throw new Error(`暗号化された ZIP は読めない: ${name}`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`ZIP のローカルヘッダが壊れている: ${name}`);
    }
    const start =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    if (raw.length !== compSize) throw new Error(`ZIP のデータが途中で切れている: ${name}`);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`未対応の圧縮方式 ${method}: ${name}`);
    if (data.length !== size) throw new Error(`ZIP の展開後のサイズが合わない: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}
