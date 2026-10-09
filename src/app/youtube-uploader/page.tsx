import type { Metadata } from "next";
import Link from "next/link";
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
} from "./_components/DocShell";

// ユーティリティ（API審査用）ページのため恒久 noindex。検索結果に出す目的はない。
export const metadata: Metadata = {
  title: `${APP_NAME} | ホーム / Home`,
  description:
    "IPO Secondary Uploader is a personal tool that uploads the operator's own videos to the operator's own two YouTube channels.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <DocShell>
      <H1 ja={APP_NAME} en="Home" />

      <Section ja="このツールについて" en="About this tool">
        <p>
          {APP_NAME}
          は、運営者本人が所有する2つの YouTube
          チャンネルへ、自作の動画をアップロードし、サムネイルを設定し、公開日時を予約するための個人用ツールです。利用者は運営者本人のみで、配布は行いません。
        </p>
        <En>
          {APP_NAME} is a personal tool that uploads videos produced by the
          operator to the two YouTube channels the operator owns, sets their
          thumbnails, and schedules their publish time. The only user is the
          operator, and the tool is not distributed.
        </En>
      </Section>

      <Section ja="使用する YouTube API Services" en="YouTube API Services used">
        <p>
          本ツールは YouTube API Services（YouTube Data API v3）を利用します。
          使用するメソッドは次のとおりです。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>videos.insert（自作動画のアップロード）</li>
          <li>thumbnails.set（サムネイルの設定）</li>
          <li>videos.list / videos.update（自分の動画の状態確認とメタデータ修正）</li>
          <li>playlistItems.insert（自分の再生リストへの追加・任意）</li>
        </ul>
        <En>
          This tool uses YouTube API Services (YouTube Data API v3): videos.insert
          to upload my own videos, thumbnails.set to set thumbnails,
          videos.list and videos.update to check the status of my own uploads
          and adjust their metadata, and optionally playlistItems.insert to add
          my own videos to my own playlists.
        </En>
        <p>
          他のユーザーやチャンネルのデータを取得・保存・表示することはありません。
        </p>
        <En>
          The tool does not access, store, or display data of other YouTube
          users or channels.
        </En>
      </Section>

      <Section ja="対象チャンネル" en="Target channels">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Ext href="https://www.youtube.com/@ipo-secondary-note">
              IPOセカンダリー検証ノート（@ipo-secondary-note）
            </Ext>
          </li>
          <li>
            <Ext href="https://www.youtube.com/channel/UC3Rf0XVb0sOtp5_yAyzD_8Q">
              株主優待の先回り買い
            </Ext>
          </li>
        </ul>
        <En>
          Both channels are owned and operated by the operator. Each video is a
          short educational clip about Japanese stock-market statistics.
        </En>
      </Section>

      <Section ja="ポリシー" en="Policies">
        <p>
          <Link href="/youtube-uploader/privacy" className="text-accent underline">
            プライバシーポリシー / Privacy Policy
          </Link>
          {" ・ "}
          <Link href="/youtube-uploader/terms" className="text-accent underline">
            利用規約 / Terms of Service
          </Link>
        </p>
      </Section>

      <Section ja="運営者・連絡先" en="Operator and contact">
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
