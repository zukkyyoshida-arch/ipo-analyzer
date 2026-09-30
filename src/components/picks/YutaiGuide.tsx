/**
 * ホームの「ピックアップ」→「優待」。株主優待の先回り買いという手法の短い説明。
 */
export function YutaiGuide() {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-text">優待</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
        <p>
          株主優待を受け取れるのは、権利付最終日の取引終了時点で株を持っている株主です。権利付最終日は権利確定日の2営業日前にあたります。
        </p>
        <p>
          人気のある優待銘柄は権利付最終日に向けて買われやすく、翌営業日の権利落ち日には下がりやすいとされます。この値動きを見越して前もって買い、権利付最終日までの値上がりをねらうのが先回り買いです。
        </p>
      </div>
    </section>
  );
}
