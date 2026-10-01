"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { newId } from "@/hooks/usePortfolio";
import {
  DANGER_BUTTON_CLASS,
  Field,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/calendar/formParts";
import { HOLDING_STRATEGY_LABELS, isValidCode, type Holding, type HoldingStrategy } from "@/lib/portfolio/types";
import { holdingStatus } from "@/lib/portfolio/judge";

/** 入力中の値（数値も文字列のまま持つ）。 */
interface Draft {
  code: string;
  name: string;
  buyPrice: string;
  shares: string;
  buyDate: string;
  strategy: HoldingStrategy;
  rightsMonth: string;
  earningsDate: string;
  memo: string;
  manualPrice: string;
  sellPrice: string;
  sellDate: string;
}

function toDraft(h: Holding | null, todayIso: string): Draft {
  return {
    code: h?.code ?? "",
    name: h?.name ?? "",
    buyPrice: h ? String(h.buyPrice) : "",
    shares: h ? String(h.shares) : "100",
    buyDate: h?.buyDate || todayIso,
    strategy: h?.strategy ?? "yutai",
    rightsMonth: h?.rightsMonth ? String(h.rightsMonth) : "",
    earningsDate: h?.earningsDate ?? "",
    memo: h?.memo ?? "",
    manualPrice: h?.manualPrice ? String(h.manualPrice.price) : "",
    sellPrice: h?.sold ? String(h.sold.price) : "",
    sellDate: h?.sold?.date ?? todayIso,
  };
}

function positive(text: string): number | null {
  const n = Number(text.replace(/,/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 保有の追加・編集シート。売却済みにする（売却価格と日付）・保有中に戻す・削除もここで行う。
 * 手入力の現在値は「入力した日（今日）時点」の値として保存する。
 */
export function HoldingSheet({
  holding,
  todayIso,
  onClose,
  onSave,
  onRemove,
}: {
  holding: Holding | null;
  todayIso: string;
  onClose: () => void;
  onSave: (h: Holding) => void;
  onRemove: (id: string) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(holding, todayIso));
  const [selling, setSelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const code = d.code.trim().toUpperCase();
  const buyPrice = positive(d.buyPrice);
  const shares = positive(d.shares);
  const month = Number(d.rightsMonth);
  const rightsMonth = d.strategy === "yutai" && Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
  const valid = isValidCode(code) && buyPrice !== null && shares !== null;
  const sellPrice = positive(d.sellPrice);
  const isSold = holding?.sold != null;

  const build = (sold: Holding["sold"]): Holding | null => {
    if (!valid || buyPrice === null || shares === null) return null;
    const manual = positive(d.manualPrice);
    const prevManual = holding?.manualPrice ?? null;
    return {
      id: holding?.id ?? newId(),
      code,
      name: d.name.trim(),
      buyPrice,
      shares,
      buyDate: ISO.test(d.buyDate) ? d.buyDate : "",
      strategy: d.strategy,
      rightsMonth,
      earningsDate: ISO.test(d.earningsDate) ? d.earningsDate : null,
      memo: d.memo.trim(),
      // 値が変わったときだけ日付を今日にする（開いて保存しただけで「今日時点」にしない）。
      manualPrice:
        manual === null ? null : prevManual && prevManual.price === manual ? prevManual : { price: manual, date: todayIso },
      sold,
    };
  };

  const preview = buyPrice !== null ? holdingStatus(buyPrice, null) : null;

  return (
    <BottomSheet open onClose={onClose} title={holding ? "保有を編集" : "保有を追加"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const h = build(holding?.sold ?? null);
          if (h) onSave(h);
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="銘柄コード">
            <input
              value={d.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="例 7203"
              autoCapitalize="characters"
              maxLength={4}
              required
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="名称">
            <input value={d.name} onChange={(e) => set("name", e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="買値（円）">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={d.buyPrice}
              onChange={(e) => set("buyPrice", e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="株数">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={d.shares}
              onChange={(e) => set("shares", e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        {preview ? (
          <p className="text-[11px] tabular-nums text-muted">
            引き上げ ¥{preview.triggerPrice.toLocaleString("ja-JP")} → 逆指値 ¥{preview.stopPrice.toLocaleString("ja-JP")} · 利確 ¥
            {preview.targetPrice.toLocaleString("ja-JP")}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="買った日">
            <input type="date" value={d.buyDate} onChange={(e) => set("buyDate", e.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label="戦略">
            <select
              value={d.strategy}
              onChange={(e) => set("strategy", e.target.value as HoldingStrategy)}
              className={INPUT_CLASS}
            >
              {(Object.keys(HOLDING_STRATEGY_LABELS) as HoldingStrategy[]).map((k) => (
                <option key={k} value={k}>
                  {HOLDING_STRATEGY_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {d.strategy === "yutai" ? (
            <Field label="権利確定月">
              <select value={d.rightsMonth} onChange={(e) => set("rightsMonth", e.target.value)} className={INPUT_CLASS}>
                <option value="">未指定</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="決算日（任意）">
            <input
              type="date"
              value={d.earningsDate}
              onChange={(e) => set("earningsDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <Field label="現在値の手入力（任意）" note="取得できない銘柄用。入力した日の値として扱います">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={d.manualPrice}
            onChange={(e) => set("manualPrice", e.target.value)}
            placeholder="空なら使わない"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="メモ">
          <input value={d.memo} onChange={(e) => set("memo", e.target.value)} className={INPUT_CLASS} />
        </Field>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
            やめる
          </button>
          <button type="submit" disabled={!valid} className={PRIMARY_BUTTON_CLASS}>
            保存
          </button>
        </div>
      </form>

      {holding ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {isSold ? (
            <button
              type="button"
              onClick={() => {
                const h = build(null);
                if (h) onSave(h);
              }}
              disabled={!valid}
              className={`${SECONDARY_BUTTON_CLASS} w-full`}
            >
              保有中に戻す
            </button>
          ) : selling ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="売却価格（円）">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={d.sellPrice}
                    onChange={(e) => set("sellPrice", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="売却日">
                  <input type="date" value={d.sellDate} onChange={(e) => set("sellDate", e.target.value)} className={INPUT_CLASS} />
                </Field>
              </div>
              <button
                type="button"
                disabled={!valid || sellPrice === null || !ISO.test(d.sellDate)}
                onClick={() => {
                  const h = sellPrice !== null ? build({ price: sellPrice, date: d.sellDate }) : null;
                  if (h) onSave(h);
                }}
                className={`${PRIMARY_BUTTON_CLASS} w-full`}
              >
                売却済みにする
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setSelling(true)} className={`${SECONDARY_BUTTON_CLASS} w-full`}>
              売却済みにする…
            </button>
          )}
          {confirmDelete ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => onRemove(holding.id)} className={DANGER_BUTTON_CLASS}>
                本当に削除する
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={SECONDARY_BUTTON_CLASS}>
                キャンセル
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className={`${DANGER_BUTTON_CLASS} w-full`}>
              削除
            </button>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}
