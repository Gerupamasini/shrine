# 夏陰 — NATSUKAGE

日本の山里を、麓の鳥居から200段の石段・神社・見晴らしの庭へ歩く、Three.js + TypeScript + Viteのデスクトップ向け3D探索プロジェクト。

**現在は操作・地形・データ移行を備えた探索可能な制作版です。依頼の「実写風の最終完成」には未到達です。** 写真地表PBRとHDRIは導入済みですが、建築は独自制作、樹木はMITのEZ Treeを調整したプロシージャルGLBで、フォトスキャンではありません。実録ヒグラシは取得できず、明記した合成環境音を同梱しています。低品質な代用品を最終完成品として扱っていません。

## 起動

Node.js 22.12以上（検証：24.22.1）、npm、WebGL2が必要です。

```sh
cd /workspace/shrine
npm ci
npm run dev
```

依存関係を再インストールした場合は、既存のViteプロセスを再起動してください。

Viteが表示するアドレスをローカルのブラウザで開き、「山里を歩く」を押します。素材はすべてローカル同梱で、起動後に外部の素材サーバーへ接続しません。

```sh
npm run build       # TypeScriptチェック + distへ本番ビルド
npm run preview     # 本番ビルドのローカル確認
npm test            # 地形・段数・GLB・配置・画像・音源データ検証
npm run test:browser # Playwrightによる探索・衝突・設定・画面の検証
```

ブラウザテストはLinuxの`/usr/bin/chromium`を標準使用します。別環境では`CHROMIUM_PATH`に実行ファイルのパスを指定してください。テストの`--use-angle=swiftshader`はGPUなしのCI向けであり、一般の閲覧者にソフトウェア描画を要求しません。

## 操作

| 操作 | キー |
|---|---|
| 前後左右 | WASD |
| 視点 | マウス。開始後クリックでPointer Lock。非対応時はドラッグ |
| 走る | Shift |
| マウス解除 | Esc |
| 撮影用フリーカメラ | F、Q/Eで上下 |
| UIを隠す・戻す | H |
| 場所・時刻・画質・音・診断 | 右上の「設定」 |

Escで解除してから設定をクリックします。音は開始操作でブラウザのAudioContextを起動し、右下または設定から切り替えられます。BGMはありません。フリーカメラでは意図的に衝突を無効にします。通常歩行にはRapierのカプセルと地形・幹・建物の簡略化コライダーを使用。

## マップ

- 1.2km四方、513²の16-bit地形。集落・川の周辺は原本間隔2.34375m、外周は4.6875mの接続した格子で描画・衝突判定。
- 高低差38m、200段（蹴上げ19cm、踏面48cm、幅5.4m）。50段×4、3mの踊り場×3。
- 本殿・拝殿、鳥居、灯籠、手水舎、狛犬、社務所、絵馬掛け、賽銭箱。
- 18軒の家屋、納屋、電柱・電線、56区画の水田、小川、橋、護岸。
- 748件の固定シード配置。枝分岐・葉の透過画像を持つ樹木GLBの3段階LOD、遠景のベイク樹冠11,000本（別JSON）、インスタンスの草・稲。
- 17〜19時の空・太陽・環境光・露出、距離減衰する3D音響、場所への移動。

遠野のような盆地を参考に、川の下刻、水田の水平面、自然堤防上の宅地、周辺山地を独自設計。測量地形の複製ではありません。神社や塩竈神社、特定作品の背景・地図をコピーしたものではありません。地形・村・建築は独自設計。時刻は美術上の補間であり、実際の天文データを再現したシミュレーションではありません。

## データと再生成

`public/assets/models`にGLB、`public/assets`に画像・HDRI・PCM音源、`public/world`に高さマップ・マスク・配置・材質定義を保存。Three.jsのシーン生成コードと分離しています。

```sh
# モデルや地形の設計を変更した場合のみ。通常起動には不要。
python -m venv /workspace/shrine-assets-venv
/workspace/shrine-assets-venv/bin/pip install -r requirements-assets.txt
# 上記venvをactivateしてから
npm run assets
```

`tools/generate_world.py`が地形・PBR原本・配置、`generate_foliage.py`が葉のアルファ画像、`generate_audio.py`が合成PCM、`build-models.mjs`が建築・小物GLB、`build-trees.mjs`が樹木GLBを生成。固定シード19940821。遠景樹冠11,000本は`world/canopy.json`へ別途書き出します。Blender原本を作成したという意味ではなく、編集可能な生成ソースを原本として納品しています。遠景の樹木PNGを更新する場合はdevサーバーの起動中に`node tools/bake-forest.mjs`を実行し、続いて`python tools/catalog-assets.py`でハッシュを更新します。外部PBRとHDRIは`npm run assets`で削除・上書きしません。欠損時は`python tools/fetch-assets.py`で固定コミットから再取得し、SHA-256を照合できます。

[Unity移行](UNITY_MIGRATION.md) / [使用素材とライセンス](ASSET_CREDITS.md) / [負荷予算](docs/PERFORMANCE_BUDGET.md) / [アセットハッシュ](docs/asset-manifest.json) / [検証結果](docs/VALIDATION.md)

## 残る制作作業

- 写実的な杉・ヒノキ・松・竹・シダ等の追加。現行は写真の葉と樹皮を使用したEZ Treeの分岐モデルで、スギ・ヒノキの樹種精度やフォトスキャン品質は未達。
- 石材・樹皮・古木・瓦・茅の高品質な写真PBRと、風化した建築ディテールの追加。
- ライセンス確認済みの実録ヒグラシ・鳥・川音への差し替え。現行の音は合成で、実際の生物音を正確に再現していない。
- 村の生活小物、用水路や石垣の増設、植生の種類と遷移の調整。
- 標準的なデスクトップGPUで1080p・60fpsの実測。ソフトウェアWebGLの結果を性能保証としない。
- 建築にも近景・遠景LODを追加済み。KTX2テクスチャ圧縮と影のカスケードは未実装。

素材サイトへの直接通信は現在のクラウド実行環境で403となりました。必要なドメインは環境設定ドラフトへ保存済みです。公開済みGitHubで取得できた素材以外の調達は、環境設定への反映後に再開できます。旧版はmainからGitHub Pagesへ公開済みです。この再構築は別ブランチで検証しています。

## GitHub Pages

リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。PRをmainへマージすると`.github/workflows/pages.yml`が検証・ビルド・公開します。PRではビルドのみ実行し、公開内容は変更しません。

公開先は `https://gerupamasini.github.io/shrine/`。`npm run build:pages`が`/shrine/`用の静的ファイルを生成し、地形・モデル・画像・音声もこのサブパスから読み込みます。リポジトリ名を変更する場合は`build:pages`の`--base`も変更してください。独自ドメインを使う場合は`/`へ変更します。

ローカルでは`npm run build:pages`の後に`npm run preview -- --base=/shrine/`を実行し、`/shrine/`を開いて確認できます。WebGL2対応PCブラウザ向けです。音声とマウス操作は開始ボタンを押すまで有効になりません。
