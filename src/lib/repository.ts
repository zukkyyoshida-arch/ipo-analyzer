import type { Ipo } from "@/types/ipo";
import type { Broker } from "@/types/broker";
import iposJson from "@/data/ipos.json";
import { DEFAULT_BROKERS } from "@/data/brokers";

// データアクセスの薄いリポジトリ層。
// 現状はローカルJSONを同期的に読むが、
// 将来 Supabase / PostgreSQL へ移行する場合はこのインターフェースの実装差し替えのみで対応する。
export interface IpoRepository {
  getAll(): Ipo[];
  getByCode(code: string): Ipo | undefined;
  getBrokers(): Broker[];
}

// JSON は resolveJsonModule により型が緩いため、ドメイン型に一度だけキャストして固定する。
const IPOS = iposJson as Ipo[];

class JsonIpoRepository implements IpoRepository {
  getAll(): Ipo[] {
    return IPOS;
  }

  getByCode(code: string): Ipo | undefined {
    return IPOS.find((ipo) => ipo.code === code);
  }

  getBrokers(): Broker[] {
    return DEFAULT_BROKERS;
  }
}

export const ipoRepository: IpoRepository = new JsonIpoRepository();

export function getAllIpos(): Ipo[] {
  return ipoRepository.getAll();
}

export function getIpoByCode(code: string): Ipo | undefined {
  return ipoRepository.getByCode(code);
}

export function getDefaultBrokers(): Broker[] {
  return ipoRepository.getBrokers();
}
