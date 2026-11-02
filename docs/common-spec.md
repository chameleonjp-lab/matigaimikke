# 間違いみっけ：共通仕様と公開手順

このPRはゲーム本体と共通UI、公開用workflowのレビュー候補です。本番公開・設定変更・マージは行っていません。実ゲーム画面のサムネイルは公開後の確認・修正へ持ち越せます。架空画像は登録しません。

## 保持するゲーム仕様

- 7×8マス、違い9個。3難易度の絵柄とnormal／上下反転／上下左右反転を維持。
- 経過秒数＋誤タップ×60秒＋ヒント×15/30/60秒。`Math.round(秒数 * 100)`、小数2桁表示、低い記録が上位。
- 送信slugは`machigai_mikke_easy`／`machigai_mikke_hard`／`machigai_mikke_super_hard`。リポジトリ名の綴りと混同しない。
- CLEARのみ送信。retire・盤面生成・タイマー・既存入力イベント・自己ベスト判定は維持。
- 既存保存キー`machigai_mikke_records_v3`と`machigai_mikke_player_name_v3`は変更しない。別originのlocalStorageは自動移行できず、旧保存を削除しない。

## 対応表

|項目|実装／残件|
|---|---|
|対象・保全|既存公開ゲームの移行。ゲームID、採点、元の記録を維持。|
|正式URL|GitHub公開URLの実動作確認までは旧正式URLを共有・canonicalに維持。|
|15言語|ja/en/es/pt-BR/zh-Hans/fr/de/ko/ru/it/zh-Hant/id/tr/vi/th。保存→ブラウザ→英語。絵柄比較問題は不変。母語レビューは未実施。|
|任意名|ホームで入力・変更・空欄保存可能。開始時名を固定。空欄は非公開。従来12 UTF-16単位上限を維持し、孤立サロゲートは除去。|
|ランキング|既存best RPCへ30件要求。実`rank_no`の同点と順序、`best_score/100`、0とnullを保持。名前ベース集約のため同名別人の識別は未解決。|
|スコア連携|現通常8列ACKを開始時名・3ASCモード・確定整数へ照合。2xxだけで成功にしない。応答整合性は本人識別・永続化readback・冪等性の証明ではない。曖昧失敗は再送しない。|
|X共有|ホーム・結果の黒白44px以上ボタン。今回の確定値/難易度/正式URLと2タグのみ。投稿は利用者が確定。popup保護、失敗時だけcopy、古いcopy完了の世代guard。|
|効果音|開始/正解/誤タップ/ヒント/クリア/自己ベスト/リタイア/遊び方。生成音のみ。実音確認は未実施。|
|音設定|初回オン0.35、保存off/0尊重。gesture初期化、hidden/offで停止・cleanup。音失敗で開始を止めない。|
|UI|長文折返し、操作をランキング一覧前に配置、安全なtextContent。iPhone Safari実機・縦横検証は未実施。|
|サムネイル|公開後の実画面から追加予定。現在は画像を宣言しないsummaryカード。未設定はpendingとして許可し、宣言した画像の欠落は検証失敗にする。|
|公開設定|PR検証のみ、mainの検証済み同コミットartifactだけ公開するworkflow候補。実CI・Pages設定・公開は未確認。|
|計測/実験場|下記の関連作業が残る。未実装を完了扱いしない。|

## 検証

Node.js 22以上、依存install不要：

```sh
node tests/common.cjs
node tests/normal-contract.cjs
node tests/integration.cjs
node tests/ui-boundaries.cjs
node tests/static.cjs
```

45ケースはbuiltin VMとfake DOM/network/audio/storageによる隔離テストです。全ゲームIIFEを実行しません。ゲームの元仕様保全は別途ローカルで比較済みですが、元の入力原本や私的証拠はこのリポジトリに含めません。実ゲーム、実API、実X HTTPヘッダ、実音、端末動作の確認と区別してください。

## CIを意図的に未実行とする初回Draft

初回コミットは`[skip ci]`付きです。GitHubのpush/pull_requestをskipし、CI成功を主張しません。第三者Actionsは固定SHA・checkout `clean: false`ですが、依存全体の削除処理等まで安全と証明したものではありません。ownerがworkflowと実行権限を確認してから、skipのない承認済みコミットでCIを開始してください。skip付きコミットがmerge messageに残ればmain公開もskipされ得ます。

workflowはPRでdeployせず、mainを直列化し、deploy直前に現在main SHAと比較します。既存の保護・必要チェックを解除しません。失敗または古いコミットなら公開しません。PagesのSourceをGitHub Actionsにする必要がある場合、その設定はownerが確認・変更してください。別の公開方式との二重配信も先に確認します。

## 残件チェックリストと適用順

1. [ ] ownerのレビュー・許可後に実CIを実行し、成功を確認。本人がマージする。
2. [ ] Pages設定・環境・権限を確認し、実際に返された公開URLで3難易度、匿名/記名、共有、設定を確認。URLをrepo名から推測して公開済みとしない。
3. [ ] 実ゲーム画面を撮影し、thumbnail assetとOG/Twitter情報を追加。宣言画像は実在ファイルと一致させる。
4. [ ] 新URL確認後に共有・canonical・OG URLを同時に正式化する関連PRを作る。それ以前は旧ページを強制転送しない。
5. [ ] 実験場の3既存slugに対応する実際の登録保存先について、ゲームURL・共有情報・詳細ランキング導線を関連PR/変更案で更新。新規登録やID変更はしない。DB変更は別途承認・事前控え・適用後readbackが必要。
6. [ ] 計測の契約を公開ランキング参加と分離して確認する。現行は名前ベース集約で、このゲームの匿名開始数を保証する仕組みはない。架空endpointや匿名の「名無し」スコアを送らない。
7. [ ] スコア連携の実環境確認と、必要なら別の冪等な契約を承認の上で検討する。通常8列ACKを9列wrapperと混同しない。大量の本番テストスコアを送らない。
8. [ ] iPhone Safari縦横・キーボード・IME確定、長文15言語、実音/off/0/復帰を確認する。

旧正式ページ： https://chameleonjp.codeberg.page/machigai_mikke/

ランキング詳細： https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=machigai_mikke

復旧はowner確認の上でこのPRをrevertし、直前の成功artifact/設定へ戻します。旧スコアや保存設定を削除しません。実験場側の更新を別途実施する場合は、その更新前の控えに基づく個別ロールバックが必要です。
