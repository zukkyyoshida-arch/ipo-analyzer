import type { Metadata } from "next";
import {
  APP_NAME,
  CONTACT_EMAIL,
  DocShell,
  En,
  Ext,
  H1,
  OWNER_EN,
  OWNER_JA,
  Section,
} from "../_components/DocShell";

// ユーティリティ（API審査用）ページのため恒久 noindex。検索結果に出す目的はない。
export const metadata: Metadata = {
  title: `利用規約 / Terms of Service | ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <DocShell>
      <H1 ja="利用規約" en="Terms of Service" />
      <p className="mt-2 text-sm text-muted">
        制定日 / Effective date: 2026-10-09
      </p>

      <Section ja="個人利用ツール" en="Personal-use tool">
        <p>
          {APP_NAME}
          は、運営者本人が自分の YouTube チャンネルを運用するための個人用ツールです。運営者以外への提供・配布は行いません。
        </p>
        <En>
          {APP_NAME} is a personal tool the operator uses to manage the
          operator&apos;s own YouTube channels. It is not offered or distributed
          to anyone else.
        </En>
      </Section>

      <Section ja="遵守する規約" en="Terms we follow">
        <p>
          本ツールは{" "}
          <Ext href="https://www.youtube.com/t/terms">YouTube 利用規約</Ext>
          および
          <Ext href="http://www.google.com/policies/privacy">
            Google プライバシーポリシー
          </Ext>
          に従って運用します。
        </p>
        <En>
          The tool is operated in accordance with the{" "}
          <Ext href="https://www.youtube.com/t/terms">YouTube Terms of Service</Ext>{" "}
          and the{" "}
          <Ext href="http://www.google.com/policies/privacy">
            Google Privacy Policy
          </Ext>
          .
        </En>
      </Section>

      <Section ja="免責" en="Disclaimer">
        <p>
          本ツールで公開する動画は、日本株の統計を紹介する教育・情報提供を目的としたもので、投資助言ではありません。個別銘柄への投資判断を示すものではなく、最終的な判断はご自身で行ってください。
        </p>
        <En>
          Videos published with this tool are educational and informational
          content about Japanese stock-market statistics. They are not
          investment advice and do not tell anyone how to act on any individual
          stock; every viewer makes their own decisions.
        </En>
      </Section>

      <Section ja="準拠法" en="Governing law">
        <p>本規約は日本法に準拠します。</p>
        <En>These terms are governed by the laws of Japan.</En>
      </Section>

      <Section ja="連絡先" en="Contact">
        <p>
          {OWNER_JA}（{OWNER_EN}）
          <br />
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </DocShell>
  );
}
