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
  title: `プライバシーポリシー / Privacy Policy | ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <DocShell>
      <H1 ja="プライバシーポリシー" en="Privacy Policy" />
      <p className="mt-2 text-sm text-muted">
        制定日 / Effective date: 2026-10-09
      </p>

      <Section ja="YouTube API Services の利用" en="Use of YouTube API Services">
        <p>
          {APP_NAME} は YouTube API Services を利用します。利用者は、
          <Ext href="https://www.youtube.com/t/terms">YouTube 利用規約</Ext>
          および
          <Ext href="http://www.google.com/policies/privacy">
            Google プライバシーポリシー
          </Ext>
          に拘束されることに同意したものとみなされます。
        </p>
        <En>
          {APP_NAME} uses YouTube API Services. By using it, you agree to be
          bound by the{" "}
          <Ext href="https://www.youtube.com/t/terms">YouTube Terms of Service</Ext>{" "}
          and the{" "}
          <Ext href="http://www.google.com/policies/privacy">
            Google Privacy Policy
          </Ext>
          .
        </En>
      </Section>

      <Section ja="取得するデータ" en="Data we access">
        <p>
          取得するのは、運営者本人が所有するチャンネルの動画メタデータ（動画ID・タイトル・公開状態など）とアップロード状態のみです。第三者のデータを取得・保存・共有することは一切ありません。
        </p>
        <En>
          The tool accesses only video metadata (such as video ID, title, and
          privacy status) and upload status of the channels owned by the
          operator. It never collects, stores, or shares data of any third
          party.
        </En>
      </Section>

      <Section ja="保存場所と保持期間" en="Storage and retention">
        <p>
          データは運営者のローカルPCにのみ保存し、外部のサーバーやクラウドへは送信しません。保持するのは自分の動画IDとアップロード記録で、運営上不要になった時点で削除します。
        </p>
        <En>
          Data is stored only on the operator&apos;s own computer and is not
          sent to any external server or cloud service. Only the operator&apos;s
          own video IDs and upload logs are kept, and they are deleted once no
          longer needed.
        </En>
      </Section>

      <Section ja="Cookie 等" en="Cookies">
        <p>本ページおよび本ツールは Cookie その他の追跡技術を使用しません。</p>
        <En>This site and the tool do not use cookies or other tracking technologies.</En>
      </Section>

      <Section ja="アクセス権の取り消し" en="Revoking access">
        <p>
          本ツールに付与した Google アカウントへのアクセス権は、
          <Ext href="https://security.google.com/settings/security/permissions">
            Google セキュリティ設定
          </Ext>
          からいつでも取り消せます。
        </p>
        <En>
          You can revoke the access granted to this tool at any time in the{" "}
          <Ext href="https://security.google.com/settings/security/permissions">
            Google security settings
          </Ext>
          .
        </En>
      </Section>

      <Section ja="改定" en="Changes to this policy">
        <p>内容を改定する場合は、本ページに掲載して反映します。</p>
        <En>Any changes to this policy will be published on this page.</En>
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
