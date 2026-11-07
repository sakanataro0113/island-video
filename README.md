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
| characters | 人物 | born、died、clothes、hair、skin、hair_style、states |
| buildings / props / plants | 建物、小物、植物 | states ごとの parts(box または cone) |
| places | 場所 | terrain、items、scatter、exclude |
| motions | 動作 | 動きの計算はコード側の `render.ts` にあります |

台本に `year` を書くと、その年の年齢で人物の見た目を選び、生まれる前や死亡後の登場はエラーにします。

## 台本

話ごとの台本は `episodes/` に置きます。カットごとに `positions`(人物の位置)、`camera`(from、to、look、look_to)、`props`(at、path、between)を指定できます。`actions` は `{do, from, to}` の形で秒を指定できます。`year` と `population` は画面上部に表示されます。

## 読み上げ音声(Google Cloud TTS)

語りとセリフを Google Cloud Text-to-Speech(Chirp 3: HD)で読み上げます。声の割り当ては `voices.yaml` に書きます。

- 画面の「音声」にチェックがあると、足りない音声を自動で作り、カットの長さを音声に合わせて延ばします
- 作った音声はブラウザに保存され、同じ文と声なら二度は作りません(無料枠の節約)
- MP4 には音声も入ります(AAC、使えないブラウザでは Opus)
- APIキーは Cloudflare 側(`worker/index.ts`)だけが使い、ブラウザには渡しません。Cloudflare Access でログインしていないと音声は作れません

### 最初の設定(1回だけ)

1. Google Cloud で Text-to-Speech API を有効にし、APIキーを作る(使えるAPIを Text-to-Speech API だけに制限する)
2. Cloudflare のダッシュボードで Workers & Pages → island-video → 設定 → 変数とシークレット に、種類「シークレット」、名前 `GOOGLE_TTS_KEY`、値にAPIキーを追加する
3. 保存すると反映されます。音声が出ないときは、もう一度 push してデプロイし直す
