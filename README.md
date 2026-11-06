# 夏陰 — NATSUKAGE

1994年8月、東北の山あいの集落。麓の鳥居から200段の石段を登って山上の神社へ向かい、境内の外れから夕暮れの村・田んぼ・小川・重なる山並みを見下ろす。Three.js + TypeScript + Vite で作った、一人称で歩けるブラウザ向けの3Dマップです。

**現状**：探索・地形・建築・植生・水・光・音・Unity用データまで、すべて実際に動く制作版です。写実性は大きく上がりましたが、AAAタイトルの最終品質には届いていません。届いていない点は「既知の限界」に書いています。素材の出典とライセンスは [ASSET_CREDITS.md](ASSET_CREDITS.md) にあります。

## 起動

Node.js 22以上、WebGL2対応のブラウザ（デスクトップのGPUを推奨）が必要です。

```sh
npm ci
npm run dev
```

表示されたアドレスを開き、「山里を歩く」を押します。素材はすべて同梱されており、起動後に外部サーバーへは接続しません。

```sh
npm run build          # 型チェック + 本番ビルド（dist/）
npm run preview        # 本番ビルドの確認
npm test               # 地形・石段・川・水田・配置・材質・音源ライセンスのデータ検証
npm run test:browser   # Playwright：石段の登坂・衝突・設定・画面（GPUなしでも可、遅い）
```

URLパラメータは次のとおりです。

- `?quality=low|standard|high`：描画品質
- `?time=17.5`：時刻
- `?place=lookout`：開始地点

開始地点には `foot`、`stairs`、`shrine`、`lookout`、`village`、`paddies`、`river` を指定できます。

## 操作

| 操作 | キー |
|---|---|
| 移動 | WASD |
| 視点 | マウス（クリックでポインタロック。使えない環境ではドラッグ） |
| 走る | Shift |
| マウス解除 | Esc |
| フリーカメラ（撮影用、衝突なし） | F、Q/Eで上下 |
| UIの表示切替 | H |
| 時刻（17:00〜19:00）・画質・移動先・音・診断表示 | 右上の「設定」 |

歩行はRapierのキャラクターコントローラーで判定します。

- 地形は16-bitの高さ場コライダー
- 石段は各フライトに踏面の段鼻を結ぶ連続スロープを置き、蹴上げに引っかからない
- 建物・鳥居・灯籠・狛犬は箱、幹は円柱のコライダー

## 世界の構成（1単位 = 1m、+Y上、北 = −Z）

| 要素 | 内容 |
|---|---|
| 地形 | 1.2km四方、1025²の16-bit高さ場（約1.17m間隔）。南北に延びる谷、四方の山、遠景（14km四方の低解像度の山並み）。西北西には夕日が谷へ差し込む鞍部がある |
| 石段 | 200段（蹴上げ17.5cm・踏面34cm・幅5.2m）。50段×4フライト、3.5mの踊り場×3。麓（7.0m）から境内（42.0m）まで35m登る。花崗岩ブロックを1段に2〜3枚、摩耗・苔・側石付き |
| 神社 | 入母屋造の拝殿（向拝・注連縄・鈴）、流造の本殿と玉垣、石と朱塗りの鳥居、春日灯籠、阿吽の狛犬、手水舎、社務所、絵馬掛け、賽銭箱、注連縄の御神木、石垣と見晴らしの柵 |
| 村 | 4つの小集落に29軒。茅葺き・瓦屋根・トタン被せの民家と土蔵、納屋、石垣、ブロック塀、電柱と電線、地蔵、バス停、軽トラック、生活小物 |
| 田畑 | 谷の等高線に沿う不整形な162区画（稲140、畑16、休耕6）。畦・法面（最大35°）付き |
| 川 | 幅4〜6m。水面は一方向に下る。河床の石、岸、橋 |
| 植生 | 杉・檜・赤松・広葉樹・欅・竹を約4.1万本。シダ・低木・雑草・苔むした岩・切り株・倒木。草と稲は実行時に生成 |

すべての配置は固定シードで再現できます。

## 光と空気

- **太陽**：NOAAの近似式による天文計算（1994年8月8日、北緯38.32°・東経141.02°、JST）。18:00で方位285.6°・高度6.7°、19:00で日没後（−4.5°）
- **直射光**：大気減衰の近似で色温度を変える（18:00で約3200K）
- **空**：雲のある写真（Poly HavenのCC0 HDRI）を太陽方位に合わせて回転。太陽円盤は解析的に描画
- **環境光**：同じHDRIから太陽を除いてIBLとして使用
- **影**：カスケードシャドウ3段（品質に応じて1024〜4096）
- **大気遠近法**：高さで減衰する霞を全マテリアル共通で適用。太陽側に暖色の前方散乱を加える
- **ポストエフェクト**：ACESトーンマッピング、弱いブルーム、周辺減光・粒子
- **植物**：葉の透過光（逆光で葉が光る）。風で樹木・草・稲が揺れ、田には風の明暗の波が渡る

## 音（BGMなし）

- **ヒグラシ**：Wikimedia Commonsの実録（Σ64、CC BY 4.0）
  - 森の中の5点に固定したHRTF立体音源で、それぞれ再生位置と速度を変え、96秒の素材が単調に繰り返して聞こえないようにしている
  - 遠景の合唱として、同じ素材のステレオ版も重ねている
  - 時刻とともに盛衰する
- **川・風・葉擦れ**：実録ではなく、Web Audioでノイズから合成している
  - 川は流路上の3点から鳴り、近づくと大きくなる
  - 風は高台ほど強い

## データと再生成

| 出力 | 原本・生成ツール |
|---|---|
| `public/world/heightmap.r16` / `.png`（16-bit）、`splat0/1.png`、`vegetation-mask.png`、`paddy-level.png`、`far-heightmap.png` | `tools/world/generate_world.py` |
| `public/world/scene.json`（石段・建物・川・道・電線・水田・目印）、`vegetation.json`、`clutter.json` | 同上 |
| `public/world/materials.json`（材質名 → 写真PBRの対応表。ランタイムとUnityで共用） | 手動で管理 |
| `public/assets/models/architecture/*.glb` | `tools/architecture/build.mjs` |
| `public/assets/models/trees/*.glb`（LOD0/LOD1、風の重みは頂点カラー） | `tools/trees/build-trees.mjs` |
| `public/assets/foliage/*`（写真の葉カード） | `tools/bake/bake-cards.mjs` → `compose_atlases.py` |
| `public/assets/textures/*`、`sky/*`、`models/props/*`、`audio/*` | `tools/assets/fetch.py` → `process_*.{py,mjs,sh}` |

```sh
pip install -r requirements-assets.txt
python3 tools/assets/fetch.py                 # Poly Haven / Commons から .cache/ へ取得
python3 tools/assets/process_textures.py
node tools/assets/process_models.mjs
tools/assets/process_audio.sh
python3 tools/world/generate_world.py
node tools/trees/build-trees.mjs
node tools/architecture/build.mjs
node tools/bake/bake-cards.mjs && python3 tools/bake/compose_atlases.py
python3 tools/assets/catalog.py               # docs/asset-manifest.json と ASSET_CREDITS.md
```

確認用のツールもあります。

- `node tools/shot.mjs <出力先> name:place:方位:俯角[:時刻]`：任意視点の撮影
- `node tools/walk-test.mjs`：登坂テスト
- `python3 tools/world/preview.py`：地図の俯瞰

[Unity移植](UNITY_MIGRATION.md) ／ [地形と配置の設計](docs/TERRAIN_DESIGN.md) ／ [負荷予算と計測](docs/PERFORMANCE_BUDGET.md)

## 既知の限界（完成品と偽らないために）

- **建築**：手続き的に作ったモデルです。柱・軒の反り・屋根の厚み・格子・注連縄までは作っていますが、組物（斗栱）や彫刻、瓦1枚ずつの形状はテクスチャで表現しています。写真測量した建築には及びません。狛犬はメタボールで作った摩耗した石像で、細部の彫りはありません。
- **樹木**：Poly Havenの実写の葉を焼いたカードと独自の枝の生成で作っています。スギとヒノキの葉の形は、モミの若木の葉を元にした近似です。遠景はビルボードです。
- **音**：実録はヒグラシのみです。川の音・風・他のセミ・鳥は、実録素材を取得できなかったため、合成音にしているか、入れていません。
- **性能**：この開発環境にはGPUがなく、SwiftShaderで描画を確認しました。実GPUでの1080p・60fpsは未計測です。品質「標準」の負荷の内訳は [docs/PERFORMANCE_BUDGET.md](docs/PERFORMANCE_BUDGET.md) にあります。
- **未実装**：God Rays（光芒）、テクスチャ圧縮（KTX2）、樹木LODのクロスフェード。
- **Sketchfabの建築モデル**：ログインが必要なため取得していません。
- **参照先**：塩竈神社と『ひぐらしのなく頃に』は雰囲気の参考に留めています。建物・地図・配置は独自設計です。
