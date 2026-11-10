# 小さな島の年代記 シミュレータ

台本(YAML)から3Dローポリ映像とMP4を作るブラウザツールです。

    npm install
    npm run dev     # 開発
    npm run build   # dist/ に公開用ファイルを生成

`main` へ push すると Cloudflare Workers に自動でデプロイされます。

## 素材

素材は `assets/` に種類ごとのYAMLで置きます。ファイルを追加すると、素材一覧に自動で出ます。

| フォルダ | 種類 | 主な項目 |
|---|---|---|
| characters | 人物 | born、died、titles(年ごとの肩書き)、clothes、hair、skin、hair_style、states |
| buildings / props / plants | 建物、小物、植物 | states ごとの parts(box または cone) |
| places | 場所 | terrain、items、scatter、exclude |
| motions | 動作 | 動きの計算はコード側の `render.ts` にあります |

台本に `year` を書くと、その年の年齢で人物の見た目を選び、生まれる前や死亡後の登場はエラーにします。

## 台本

話ごとの台本は `episodes/` に置きます。カットごとに `positions`(人物の位置)、`camera`(下の3通り)、`props`(at、path、between)を指定できます。`actions` は `{do, from, to}` の形で秒を指定できます。`year` と `population` は画面上部に表示されます。

カメラ(`camera`)の書き方
- `{from, to, look, look_to}`: from から to へ動きながら、look から look_to を見る
- `{path: [{at}, {at}, …], fov: 80, bank: 25}`: FPV。点を順に一定の速さで飛び、進む向きを見て、曲がるときに傾く。点に `look` を書くと、その点ではそこを見る
- `{orbit: {center, radius, height, start: 0, turns: 1, look}}`: center の周りを一定の速さで回る。`turns: 1` で360°
- どれも `fov`(縦の画角、度)を書ける

### 言語(日本語と英語)

台本は1つの話に1つで、字幕と画面の文字だけを言語ごとに持ちます。起きる出来事、映像、カットの順番は共通です。映像タブの「言語」で切り替えると、字幕、上の表示(`Year 1 on the island | 38 people`)、名札、話者名、読み上げの文、字幕の見た目が切り替わります。書き出す MP4 の名前も、その言語の題名になります。

英語版の書き方
- 台本の一番上に `title_en: "Episode 1: …"` を書く
- カットごとに `en: {narration: "…", caption: "…", labels: [{text, sub}], speaker_title: "…"}` を書く。日本語に字幕(または `caption`、`labels`)があるのに英語がないカットがあると、英語に切り替えたときにエラーで知らせます
- `labels` は、日本語の `labels` と同じ順番、同じ数で書く
- 強調は日本語と同じく `[語句]`。セリフの引用符 `"…"` は字幕には出ず、話者名の札で分かるようにしています
- 人物の英語名と肩書きは、人物の素材に `name_en` と `titles_en` で書きます

英語の字幕は、語の切れ目で区切って出します(「一度に出す文字数」は英語では語数)。a、the、of などの短い語で区切りを終えないようにしています。表示時間の目安は、英語では1秒に2.8語です。

## 字幕の見た目

映像タブの「字幕の見た目」で、表示の形(短く区切って次々に出す/白い札にまとめる)、書体、大きさ、位置、一度に出す文字数、色、縁取り、影などを変えられます。開いている間は、プレビューの上をドラッグすると位置が動きます。「保存」すると Cloudflare D1(表 `prefs`)に言語ごとに保存され、書き出す MP4 にも同じ見た目が使われます。

セリフの話者名の下には、人物の titles から、その話の年の肩書き(所属と役職)を出します。出すのは、その話で最初のセリフだけ、毎回、出さないから選べます。台本のカットに `speaker_title` を書くと、そのカットだけ肩書きを変えられます。

短く区切る形では、字幕を句読点と文字数で区切り、読み上げ音声の長さに合わせて順に出します(音声がないときはカットの長さに合わせます)。

## 読み上げ音声

語りとセリフを読み上げます。音声合成の種類は `voices.yaml` の `engine` で切り替えます。

声の割り当て(語りと人物ごとの声、話し方の指示)と読み方の辞書は、サイトの「音声一覧」「読み方」タブで編集し、Cloudflare D1(`DB`)に保存します。人物ごと・文ごとの行として保存し、保存のときは変えた行だけを書くため、別の PC で同時に変えたほかの行は消えません。一度も保存していないときは、`voices.yaml` の `narrator`、`characters`、`spots` を初期値として使います。

| engine | 使うもの | 料金 | Cloudflare のシークレット |
|---|---|---|---|
| `gemini`(今の設定) | Gemini 3.8 Flash TTS(Gemini API) | 有料(プリペイド) | `GEMINI_API_KEY` |
| `chirp` | Google Cloud TTS の Chirp 3: HD | 毎月100万字まで無料 | `GOOGLE_TTS_KEY` |

- 画面の「音声」にチェックがあると、足りない音声を自動で作り、カットの長さを音声に合わせて延ばします。作成中は映像の下に進み具合が出ます。1つでも失敗したら、残りは作らずに止まります
- 読み方は、文の中の箇所ごとに指定します(読み方タブで字幕をクリック)。同じ漢字でも、ほかの箇所や文は変わりません。字幕はそのままです
- 作った音声はブラウザに保存され、同じ文と設定なら二度は作りません(料金の節約)。声、話し方の指示、temperature などを変えると作り直します
- 声がほとんど入っていない音声や、後ろに長い無音が付いた音声は失敗として扱い、保存しません
- Gemini の話し方の指示(`style`)は本文とは別に送ります。本文に書くと、指示まで読み上げられることがあります
- MP4 には音声も入ります(AAC、使えないブラウザでは Opus)
- APIキーは Cloudflare 側(`worker/index.ts`)だけが使い、ブラウザには渡しません。Cloudflare Access でログインしていないと音声は作れません

### 最初の設定(1回だけ)

Gemini(`engine: gemini`)
1. Google AI Studio で課金を設定する(プリペイド。自動チャージはしない)。Spend で月額上限も決める
2. AI Studio の API keys でキーを作る
3. Cloudflare のダッシュボードで Workers & Pages → island-video → 設定 → 変数とシークレット に、種類「シークレット」、名前 `GEMINI_API_KEY`、値にAPIキーを追加する

Chirp(`engine: chirp`)
1. Google Cloud で Text-to-Speech API を有効にし、APIキーを作る(使えるAPIを Text-to-Speech API だけに制限する)
2. 同じ画面で、名前 `GOOGLE_TTS_KEY` のシークレットを追加する

保存すると反映されます。音声が出ないときは、もう一度 push してデプロイし直してください。

設定の保存先(D1)
- `wrangler.jsonc` の `d1_databases` に database_id を書いていないため、最初のデプロイで自動的に作られます。表(voices、spots)は、最初に使ったときに自動で作ります
- 自動で作られなかった場合(「設定の保存先(D1 の DB)がありません」と出る場合)は、Cloudflare のダッシュボードで Storage & Databases → D1 → Create でデータベースを作り、island-video → 設定 → バインディング に、種類「D1 データベース」、変数名 `DB` で追加する
