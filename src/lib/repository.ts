import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { IpoAuto, IpoBase, MarketData } from "@/types/data";
import type { IpoEnriched } from "@/types/enriched";
import type { HistoricalIpo } from "@/types/history";
import { DEFAULT_BROKERS } from "@/data/brokers";
import { mergeIpos } from "@/lib/merge";
// フォールバック用にリポジトリ同梱の public/data/*.json をバンドルする。
// DATA_BASE_URL 未設定 or リモート取得失敗時はこれを使う。
import bundledBase from "../../public/data/ipos.base.json";
import bundledAuto from "../../public/data/ipos.auto.json";
import bundledEnriched from "../../public/data/ipos.enriched.json";
import bundledMarket from "../../public/data/market.json";
import bundledHistory from "../../public/data/ipos.history.json";
import bundledHot from "../../public/data/hot.json";
import bundledHoldings from "../../public/data/holdings.json";
import { parseHoldingsFile } from "@/lib/holdings/file";
import type { HoldingsFile } from "@/lib/holdings/types";
import bundledMidterm from "../../public/data/midterm.json";
import { parseHotFile, type HotFile } from "@/lib/hot/file";
import { parseMidFile, type MidFile } from "@/lib/midterm/file";
import bundledFins from "../../public/data/fins.json";
import bundledMargin from "../../public/data/margin.json";
import { parseFinsFile } from "@/lib/fins/file";
import { parseMarginFile } from "@/lib/margin/file";
import type { FinsFile } from "@/types/fins";
import type { MarginFile } from "@/types/margin";

// データアクセスの薄いリポジトリ層。
// - DATA_BASE_URL が設定されていれば ISR（revalidate 300秒）でリモート JSON を取得。
// - 未設定 or 取得失敗時はリポジトリ同梱の public/data/*.json にフォールバック。
// - base（手動）＋ enriched（96ut 補完）＋ auto（updater）をマージして最終的な Ipo 配列を得る。

const FALLBACK_BASE = bundledBase as IpoBase[];
const FALLBACK_AUTO = bundledAuto as IpoAuto[];
// 空配列 [] の JSON は never[] と推論されるため unknown 経由でキャストする。
const FALLBACK_ENRICHED = bundledEnriched as unknown as IpoEnriched[];
const FALLBACK_MARKET = bundledMarket as MarketData;
const FALLBACK_HISTORY = bundledHistory as unknown as HistoricalIpo[];

/** ISR 再検証間隔（秒）。 */
const REVALIDATE_SECONDS = 300;

function dataBaseUrl(): string | undefined {
  const url = process.env.DATA_BASE_URL;
  return url && url.trim().length > 0 ? url.trim() : undefined;
}

/** リモートから 1 ファイル取得。失敗（ネットワーク/非200/JSON不正）時は null。 */
async function fetchJson<T>(baseUrl: string, file: string): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/${file}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // ネットワーク不通・JSON パース失敗等はフォールバックへ委ねる。
    return null;
  }
}

export interface IpoDataSet {
  ipos: Ipo[];
  market: MarketData;
  /** 96ut 由来の補完レイヤー（Ipo 型に無い業績・株主・幹事配分などの参照用）。 */
  enriched: IpoEnriched[];
}

/**
 * 4ファイル（base/auto/enriched/market）を取得しマージした結果を返す。
 * リモート取得はファイル単位でフォールバックする（片方失敗しても既存同梱で継続）。
 */
export async function loadIpoData(): Promise<IpoDataSet> {
  const baseUrl = dataBaseUrl();

  let base = FALLBACK_BASE;
  let auto = FALLBACK_AUTO;
  let market = FALLBACK_MARKET;
  let enriched = FALLBACK_ENRICHED;

  if (baseUrl) {
    const [remoteBase, remoteAuto, remoteMarket, remoteEnriched] =
      await Promise.all([
        fetchJson<IpoBase[]>(baseUrl, "ipos.base.json"),
        fetchJson<IpoAuto[]>(baseUrl, "ipos.auto.json"),
        fetchJson<MarketData>(baseUrl, "market.json"),
        fetchJson<IpoEnriched[]>(baseUrl, "ipos.enriched.json"),
      ]);
    if (remoteBase) base = remoteBase;
    if (remoteAuto) auto = remoteAuto;
    if (remoteMarket) market = remoteMarket;
    if (Array.isArray(remoteEnriched)) enriched = remoteEnriched;
  }

  return { ipos: mergeIpos(base, auto, enriched), market, enriched };
}

export async function getAllIpos(): Promise<Ipo[]> {
  const { ipos } = await loadIpoData();
  return ipos;
}

export async function getIpoByCode(code: string): Promise<Ipo | undefined> {
  const { ipos } = await loadIpoData();
  return ipos.find((ipo) => ipo.code === code);
}

export async function getAllEnriched(): Promise<IpoEnriched[]> {
  const { enriched } = await loadIpoData();
  return enriched;
}

/** code で enriched レコードを探す純関数（未取得なら undefined）。 */
export function findEnriched(
  all: IpoEnriched[],
  code: string,
): IpoEnriched | undefined {
  return all.find((e) => e.code === code);
}

export async function getEnrichedByCode(
  code: string,
): Promise<IpoEnriched | undefined> {
  const { enriched } = await loadIpoData();
  return findEnriched(enriched, code);
}

export async function getMarketData(): Promise<MarketData> {
  const { market } = await loadIpoData();
  return market;
}

/**
 * 2015〜2023 年の履歴（統計の母数拡大用）。サーバー側の集計専用で、クライアントへは渡さない。
 * DATA_BASE_URL があればリモートを優先し、失敗・不正時は同梱にフォールバック。
 */
export async function getHistoricalIpos(): Promise<HistoricalIpo[]> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = await fetchJson<HistoricalIpo[]>(baseUrl, "ipos.history.json");
    if (Array.isArray(remote) && remote.length > 0) return remote;
  }
  return FALLBACK_HISTORY;
}

/**
 * いま熱い銘柄（夜間のデータ更新で作る hot.json）。無い・形が崩れているときは null。
 * DATA_BASE_URL があればリモートを優先し、失敗・不正時は同梱にフォールバック。
 */
export async function getHotData(): Promise<HotFile | null> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = parseHotFile(await fetchJson<unknown>(baseUrl, "hot.json"));
    if (remote) return remote;
  }
  return parseHotFile(bundledHot);
}

/**
 * 大量保有報告書（夜間のデータ更新で作る holdings.json）。無い・形が崩れているときは null。
 * 選定は src/lib/holdings/score.ts の pickHoldings、出典表記は src/lib/holdings/types.ts。
 * DATA_BASE_URL があればリモートを優先し、失敗・不正時は同梱にフォールバック。
 */
export async function getHoldingsData(): Promise<HoldingsFile | null> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = parseHoldingsFile(await fetchJson<unknown>(baseUrl, "holdings.json"));
    if (remote) return remote;
  }
  return parseHoldingsFile(bundledHoldings);
}

/**
 * 中長期セカンダリの材料（夜間のデータ更新で作る midterm.json）。無い・形が崩れているときは null。
 * DATA_BASE_URL があればリモートを優先し、失敗・不正時は同梱にフォールバック。
 */
export async function getMidtermData(): Promise<MidFile | null> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = parseMidFile(await fetchJson<unknown>(baseUrl, "midterm.json"));
    if (remote) return remote;
  }
  return parseMidFile(bundledMidterm);
}

/** J-Quants 財務（fins.json）。中長期セカンダリの業績・財務チェックに使う。 */
export async function getFinsData(): Promise<FinsFile | null> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = parseFinsFile(await fetchJson<unknown>(baseUrl, "fins.json"));
    if (remote) return remote;
  }
  return parseFinsFile(bundledFins);
}

/** JPX 信用残（margin.json）。中長期セカンダリの信用買残チェックに使う。 */
export async function getMarginData(): Promise<MarginFile | null> {
  const baseUrl = dataBaseUrl();
  if (baseUrl) {
    const remote = parseMarginFile(await fetchJson<unknown>(baseUrl, "margin.json"));
    if (remote) return remote;
  }
  return parseMarginFile(bundledMargin);
}

export function getDefaultBrokers(): Broker[] {
  return DEFAULT_BROKERS;
}
