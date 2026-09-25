import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import type { IpoAuto, IpoBase, MarketData } from "@/types/data";
import { DEFAULT_BROKERS } from "@/data/brokers";
import { mergeIpos } from "@/lib/merge";
// フォールバック用にリポジトリ同梱の public/data/*.json をバンドルする。
// DATA_BASE_URL 未設定 or リモート取得失敗時はこれを使う。
import bundledBase from "../../public/data/ipos.base.json";
import bundledAuto from "../../public/data/ipos.auto.json";
import bundledMarket from "../../public/data/market.json";

// データアクセスの薄いリポジトリ層。
// - DATA_BASE_URL が設定されていれば ISR（revalidate 300秒）でリモート JSON を取得。
// - 未設定 or 取得失敗時はリポジトリ同梱の public/data/*.json にフォールバック。
// - base（手動）＋ auto（updater）をマージして最終的な Ipo 配列を得る。

const FALLBACK_BASE = bundledBase as IpoBase[];
const FALLBACK_AUTO = bundledAuto as IpoAuto[];
const FALLBACK_MARKET = bundledMarket as MarketData;

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
}

/**
 * 3ファイル（base/auto/market）を取得しマージした結果を返す。
 * リモート取得はファイル単位でフォールバックする（片方失敗しても既存同梱で継続）。
 */
export async function loadIpoData(): Promise<IpoDataSet> {
  const baseUrl = dataBaseUrl();

  let base = FALLBACK_BASE;
  let auto = FALLBACK_AUTO;
  let market = FALLBACK_MARKET;

  if (baseUrl) {
    const [remoteBase, remoteAuto, remoteMarket] = await Promise.all([
      fetchJson<IpoBase[]>(baseUrl, "ipos.base.json"),
      fetchJson<IpoAuto[]>(baseUrl, "ipos.auto.json"),
      fetchJson<MarketData>(baseUrl, "market.json"),
    ]);
    if (remoteBase) base = remoteBase;
    if (remoteAuto) auto = remoteAuto;
    if (remoteMarket) market = remoteMarket;
  }

  return { ipos: mergeIpos(base, auto), market };
}

export async function getAllIpos(): Promise<Ipo[]> {
  const { ipos } = await loadIpoData();
  return ipos;
}

export async function getIpoByCode(code: string): Promise<Ipo | undefined> {
  const { ipos } = await loadIpoData();
  return ipos.find((ipo) => ipo.code === code);
}

export async function getMarketData(): Promise<MarketData> {
  const { market } = await loadIpoData();
  return market;
}

export function getDefaultBrokers(): Broker[] {
  return DEFAULT_BROKERS;
}
