# ファイル圧縮君：Codex適用記録
確認日：2026-11-05（日本時間）。対象：ken-tak-steam/file_asshukun の取得時の既定ブランチ。アプリ本体の改修・実機テストは今回実施していない。

## 確認した現状
約5.08MBのHTMLをblob取得。外部script srcなし、CSP connect-src 'none'。READMEはPDFの文字・リンク保持モードと画像化モードを区別。動画・音声の形式はブラウザ依存。過去チャットのWebKit確認はSafari/iPad実機確認ではない。

## 本体ライセンス
LICENSE全文を確認。独自の非商用条件。教材利用の例外と第三者ソフトウェアの権利を制限しない条項あり。既存条件を維持する。

## 依存ライブラリ・付属データ
package.jsonとTHIRD_PARTY_NOTICES.txt確認：PDF.js 5.6.205 Apache-2.0、pdf-lib 1.17.1 MIT、fflate 0.8.2 MIT、fix-webm-duration 1.0.6 MIT。通知には@pdf-lib/standard-fonts 1.0.0 MIT、@pdf-lib/upng 1.0.1 MIT、pako 1.0.11 (MIT AND Zlib)、core-js MITも収録。CMapはAdobeの条件、LiberationはSIL OFL 1.1、Foxit/PDFium、JBIG2/OpenJPEG/QCMS等の個別文面も収録。各データへの対応と全推移的依存の網羅は追加照合が必要。開発依存esbuild 0.25.12の本文とpackage-lock全件監査は未実施。

## 次の適用順序
優先1：iPad Safari実機で画像/PDF/ZIP保存と動画・音声の機能検出・非対応表示を確認。優先2：既存画像化モードの明示選択と、文字保持モードの検索・リンク回帰確認。優先3：第三者通知の対応確認とオフライン起動を検証。

## 取得根拠
- README.md: fdbfe5ae93c3d2bd9d9ea1c24da67619653f122b
- LICENSE: e5917e63fe26ff84cea32aa10e0625379410bb39
- index.html: df288734cbadf3649233cbee2160e15b04c23739
ソース：https://github.com/ken-tak-steam/file_asshukun
取得したコードとREADMEの記述、過去チャットの報告は区別する。取得時点のファイル単位のSHAであり、リポジトリ全体の同一コミットを保証しない。

## 今回の変更範囲
AGENTS.mdとdocs/CODEX_APP.md、docs/CODEX_TEMPLATES.mdの追加のみ。既存HTML・ライセンス本文・依存バージョン・公開設定は変更しない。共通ルールは目標であり、現アプリが全条件を満たす証明ではない。
