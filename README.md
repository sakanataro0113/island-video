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
