# 使用素材と出典

このファイルは `python3 tools/assets/catalog.py` が生成します。全ファイルのパス・サイズ・SHA-256・出典は [`docs/asset-manifest.json`](docs/asset-manifest.json)（195ファイル、計73.4MB）にあります。

## 外部素材

### 録音（クレジット表記が必要）

| 素材 | 作者 | ライセンス | 配布ページ | 用途 |
|---|---|---|---|---|
| Tanna japonensis v01.ogg（ヒグラシ、2011年7月17日、川崎市麻生区） | Σ64 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tanna_japonensis_v01.ogg) | ヒグラシの声（立体音源5基＋遠景） |

**表記例**：ヒグラシの録音 “Tanna japonensis v01.ogg” by Σ64, Wikimedia Commons, CC BY 4.0。加工：280Hz以下の除去、軽いノイズ低減、音量正規化、モノラル化。

`Higurashi 06c5856.ogg`（cory、CC BY 2.1 JP）も候補として確認しましたが、今回はWikimediaのレート制限（HTTP 429）で取得できず**未使用**です。Freesoundの`AkasakaHieJinjaCicadas_4mics.wav`（CC0）はダウンロードにログインが必要なため**未使用**です。

### Poly Haven（CC0 1.0。商用利用・改変・再配布可、表記義務なし）

ライセンスは https://polyhaven.com/license で確認しました（`public/assets/licenses/PolyHaven-asset-license.json`）。作者名は取得時にPoly HavenのAPIから記録したもので、任意のクレジットとして掲載します。

| 種別 | アセットID | 作者 | 用途 |
|---|---|---|---|
| テクスチャ | [forest_leaves_02](https://polyhaven.com/a/forest_leaves_02) | Rob Tuytel | terrain: forest floor (needle and leaf litter, moss) |
| テクスチャ | [leafy_grass](https://polyhaven.com/a/leafy_grass) | Charlotte Baglioni | terrain: mown grass, embankments |
| テクスチャ | [stony_dirt_path](https://polyhaven.com/a/stony_dirt_path) | eye-candy.xyz | terrain: footpaths, farm tracks |
| テクスチャ | [brown_mud_leaves_01](https://polyhaven.com/a/brown_mud_leaves_01) | Rob Tuytel | terrain: paddy mud, wet soil |
| テクスチャ | [river_small_rocks](https://polyhaven.com/a/river_small_rocks) | Rico Cilliers, Rob Tuytel | terrain: river bed |
| テクスチャ | [mossy_rock](https://polyhaven.com/a/mossy_rock) | Rob Tuytel | terrain: steep rock |
| テクスチャ | [gravel_floor_02](https://polyhaven.com/a/gravel_floor_02) | Dimitrios Savva, Jenelle van Heerden | shrine precinct gravel |
| テクスチャ | [worn_asphalt](https://polyhaven.com/a/worn_asphalt) | Amal Kumar | village road |
| テクスチャ | [rock_surface](https://polyhaven.com/a/rock_surface) | Amal Kumar | stone steps, lanterns, komainu |
| テクスチャ | [japanese_stone_wall](https://polyhaven.com/a/japanese_stone_wall) | Charlotte Baglioni, Dario Barresi, Rico Cilliers | ishigaki retaining walls |
| テクスチャ | [mossy_stone_wall](https://polyhaven.com/a/mossy_stone_wall) | Amal Kumar | mossy walls, step risers |
| テクスチャ | [hinoki_planks](https://polyhaven.com/a/hinoki_planks) | Charlotte Baglioni | shrine timber |
| テクスチャ | [japanese_cedar_planks](https://polyhaven.com/a/japanese_cedar_planks) | Charlotte Baglioni, Rico Cilliers | house timber |
| テクスチャ | [weathered_plank_siding](https://polyhaven.com/a/weathered_plank_siding) | Dimitrios Savva | shitami-ita board siding |
| テクスチャ | [wood_peeling_paint_weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) | Dimitrios Savva, Rob Tuytel | paint mask source for the derived vermilion texture |
| テクスチャ | [grey_roof_tiles](https://polyhaven.com/a/grey_roof_tiles) | Rob Tuytel | kawara roofs |
| テクスチャ | [thatch_roof_angled](https://polyhaven.com/a/thatch_roof_angled) | Dimitrios Savva, Rob Tuytel | kayabuki thatch |
| テクスチャ | [rusty_corrugated_iron](https://polyhaven.com/a/rusty_corrugated_iron) | Charlotte Baglioni | tin roofs, sheds |
| テクスチャ | [white_plaster_rough_01](https://polyhaven.com/a/white_plaster_rough_01) | Rob Tuytel | shikkui plaster walls |
| テクスチャ | [clay_plaster](https://polyhaven.com/a/clay_plaster) | Amal Kumar | tsuchikabe clay walls |
| テクスチャ | [concrete_block_wall](https://polyhaven.com/a/concrete_block_wall) | Charlotte Baglioni | block walls |
| テクスチャ | [japanese_cedar_bark](https://polyhaven.com/a/japanese_cedar_bark) | Charlotte Baglioni | sugi trunks |
| テクスチャ | [metasequoia_bark](https://polyhaven.com/a/metasequoia_bark) | Charlotte Baglioni | hinoki trunks (similar fibrous strip bark) |
| テクスチャ | [pine_bark](https://polyhaven.com/a/pine_bark) | Dimitrios Savva | akamatsu lower trunk |
| テクスチャ | [japanese_zelkova_bark](https://polyhaven.com/a/japanese_zelkova_bark) | Charlotte Baglioni | broadleaf trunks |
| 3Dモデル | [fern_02](https://polyhaven.com/a/fern_02) | Rico Cilliers, Rob Tuytel | fern clutter |
| 3Dモデル | [shrub_02](https://polyhaven.com/a/shrub_02) | Rico Cilliers | undergrowth shrub |
| 3Dモデル | [shrub_03](https://polyhaven.com/a/shrub_03) | Rico Cilliers | undergrowth shrub |
| 3Dモデル | [shrub_04](https://polyhaven.com/a/shrub_04) | Rico Cilliers | undergrowth shrub |
| 3Dモデル | [weed_plant_02](https://polyhaven.com/a/weed_plant_02) | Rico Cilliers, Rob Tuytel | roadside weed |
| 3Dモデル | [nettle_plant](https://polyhaven.com/a/nettle_plant) | Rico Cilliers, Rob Tuytel | roadside weed |
| 3Dモデル | [rock_moss_set_01](https://polyhaven.com/a/rock_moss_set_01) | Kless Gyzen | mossy rocks |
| 3Dモデル | [rock_moss_set_02](https://polyhaven.com/a/rock_moss_set_02) | Kless Gyzen | mossy rocks |
| 3Dモデル | [rock_07](https://polyhaven.com/a/rock_07) | Jenelle van Heerden | river boulder |
| 3Dモデル | [rock_09](https://polyhaven.com/a/rock_09) | Jenelle van Heerden | river boulder |
| 3Dモデル | [stone_01](https://polyhaven.com/a/stone_01) | Dario Barresi, Rico Cilliers | river stones |
| 3Dモデル | [tree_stump_01](https://polyhaven.com/a/tree_stump_01) | Rob Tuytel | forest stump |
| 3Dモデル | [dead_tree_trunk](https://polyhaven.com/a/dead_tree_trunk) | Rob Tuytel | fallen trunk |
| 3Dモデル | [wooden_bucket_01](https://polyhaven.com/a/wooden_bucket_01) | James Ray Cock | village prop |
| 3Dモデル | [wooden_barrels_01](https://polyhaven.com/a/wooden_barrels_01) | James Ray Cock | village prop |
| 3Dモデル | [wooden_crate_01](https://polyhaven.com/a/wooden_crate_01) | James Ray Cock | village prop |
| 3Dモデル | [wicker_basket_01](https://polyhaven.com/a/wicker_basket_01) | Kuutti Siitonen | village prop |
| 3Dモデル | [wooden_ladder](https://polyhaven.com/a/wooden_ladder) | Miroslav Turura | village prop |
| 3Dモデル | [wooden_broom](https://polyhaven.com/a/wooden_broom) | Balen | shrine prop |
| 葉カードの原本 | [fir_sapling](https://polyhaven.com/a/fir_sapling) | Rico Cilliers, Rob Tuytel | baked into conifer spray cards (sugi/hinoki tint) |
| 葉カードの原本 | [pine_sapling_small](https://polyhaven.com/a/pine_sapling_small) | Rico Cilliers, Rob Tuytel | baked into pine needle cards (akamatsu) |
| 葉カードの原本 | [tree_small_02](https://polyhaven.com/a/tree_small_02) | Rico Cilliers | baked into broadleaf leaf cluster cards |
| HDRI | [evening_road_01_puresky](https://polyhaven.com/a/evening_road_01_puresky) | Jarod Guest, Sergej Majboroda | sky dome backdrop (clouds) and image based light |

Poly Havenの植物モデル（`fir_sapling`、`pine_sapling_small`、`tree_small_02`）は、そのままではWebで扱えない重さ（数十〜数百MB）です。そのため、写真の葉のジオメトリを正射影で撮影して葉カード（`public/assets/foliage/*-albedo.png` / `*-normal.png`）に焼き、樹木は本リポジトリの生成器で作っています。生成した樹木は「Poly Havenの樹木スキャン」ではありません。

## 本プロジェクトで生成した素材（CC0 1.0として再利用可）

| 素材 | 生成元 |
|---|---|
| 地形の16-bit高さマップ、スプラットマスク、植生マスク、水田の水位、配置JSON | `tools/world/generate_world.py`（固定シード19940808） |
| 神社・鳥居・灯籠・狛犬・民家・蔵・納屋・電柱・橋・軽トラック・石段などのGLB | `tools/architecture/build.mjs`（実在の特定建築・作品の複製ではない独自設計） |
| 杉・檜・赤松・広葉樹・欅・竹のGLB（LOD0/LOD1） | `tools/trees/build-trees.mjs` |
| 竹の稈と葉のテクスチャ | 手続き的生成（本リポジトリ） |
| 朱塗りテクスチャ `vermilion_paint` | Poly Havenの2素材から派生（`process_textures.py`） |
| 川・風・葉擦れの音 | 実行時にWeb Audioでノイズから合成（`src/audio.ts`）。**実録ではありません** |

## ライブラリ

Three.js（MIT）、Rapier（Apache-2.0）、Vite（MIT）、TypeScript（Apache-2.0）、Playwright（Apache-2.0）、glTF-Transform（MIT）、meshoptimizer（MIT）、sharp（Apache-2.0）。

## 使っていない候補

- Sketchfabの日本建築モデル（CC BY）：ダウンロードにはSketchfabへのログインやAPIトークンが必要です。今回の環境では取得しておらず、使っていません。
- Kenney Nature Kit：ローポリ様式なので、写実性の要件に合わず採用していません。
- GrassSimulation（gzatravkin）：ライセンスの表示がないため、コードを参照・流用していません。
