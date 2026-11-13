# Unity移植

再利用するのは、モデル・地形・配置・材質・環境設定のデータです。照明・ポストエフェクト・風・水・草・霞のシェーダーは、移植先のレンダーパイプライン（HDRP/URP）で作り直す前提です。Three.js固有のシェーダーは、データとしては持ち込みません。

## 座標と単位

| | このプロジェクト（Three.js） | Unity |
|---|---|---|
| 手系 | 右手系 | 左手系 |
| 上 | +Y | +Y |
| 北 | −Z | +Z（Z反転後） |
| 単位 | 1 = 1m | 1 = 1m |

- **位置**：`(x, y, z) → (x, y, −z)`
- **Y軸回転（JSONの `rotation[1]`、ラジアン）**：`Quaternion.Euler(0, -yaw * Mathf.Rad2Deg, 0)`
- **一般のクォータニオン**：`(qx, qy, qz, qw) → (−qx, −qy, qz, qw)`
- **glTFのインポート**：glTFastなどのインポーターが、モデル内部の座標変換をすでに行います。配置座標の変換と二重に掛けないでください。
- **方位**：シーン内の方位はコンパス方位（北0°・時計回り）。前方ベクトルは `(sin az, 0, −cos az)` です。

## 地形（Unity Terrain）

`public/world/scene.json` の `heightEncoding` を参照します。

1. `TerrainData.heightmapResolution = 1281`（Unityは2^n+1のみ対応のため、2049へ補間して読み込む）、`size = (1500, 420, 1500)` にし、Terrainの位置を `(−600, −20, −600)` にする。
2. `heightmap.r16` を読む。ヘッダーなし、uint16 little-endian、行優先、1行目がz=−750（北端）、1列目がx=−750。
   - 高さは `y = raw / 65535 × 420 − 20`、Unityに入れる値は `raw / 65535f`。
3. Z反転のため、`heights[row, col]` に入れる際に行を逆順にする（Unityの行0は南端になる）。
4. `splat0.png`・`splat1.png`・`splat2.png`（RGBA×3、うち11層を使用）をAlphamapにする。層の順番と使うテクスチャは `materials.json` の `terrainLayers` にある。
   - 順番：grass / forest / dirt / rock / paddy / riverbed / gravel / asphalt / furrows / bar（砂州の乾いた礫）
   - 画像も同じく上下反転する。各層の `size` がTerrainLayerの `tileSize` に当たる。
   - `fixed: true` の層（furrows＝畑の畝）は回転させずに貼る。畝は世界のX方向に走り、作物の列（`clutter.json` の `crop`）と揃っている。
5. `vegetation-mask.png` を植生・Detailの密度に使う。
   - R：森の密度
   - G：区画IDのハッシュ
   - B：稲の内側
   - A：草の密度
6. `paddy-level.png` は稲がある区画の田面高さ（16-bit、高さマップと同じ変換式）。稲以外のセルは−20（最小値）。
7. `far-heightmap.png`（257²、14km四方、0〜1600m）は遠景の山並み。別のTerrain、またはLODを粗くしたメッシュとして配置する。
   - 地図の周囲1.6kmの中景は `mid-heightmap.png` と `mid-cover.png`。形式と範囲は `public/world/far-terrain.json` にある（`src/world/far.ts` の読み込み処理と同じ変換）。中景は地図の外周に接するリング状のTerrain（またはメッシュ）として置き、地図の中は描かない。
8. 側溝の開口とトンネルの坑口は、地形を掘らずに地形シェーダーで地面を描かないことで見せている（`scene.json` の `ditch` と `tunnel`）。UnityではTerrainのHoles（`TerrainData.SetHoles`）か、地形の上に置くメッシュで同じ形を作る。地図は `map.webp` と `map.json`（地名と位置）をUIに使う。

## 配置

| ファイル | 内容 | 形式 |
|---|---|---|
| `scene.json` の `objects` | 建物・鳥居・灯籠など | `asset`・`position`・`rotation`・`scale`・`variant`・コライダー寸法 |
| `scene.json` の `steps` | 200段の各段 | 段鼻のx、踏面の上端y、z、幅、奥行き、蹴上げ |
| `scene.json` の `stair` | 石段の全体寸法 | |
| `vegetation.json` | 樹木（樹種ごと） | `[x, y, z, scale, yaw, variant, lean]` |
| `clutter.json` | 下草・岩・畑の作物（`crop`、variantは作物の種類）など | `[x, y, z, scale, yaw, variant]` |
| `scene.json` の `river.points` | 川の水面。河床の中心を通るX方向の断面 | `[x, waterY, z, widthX, fall, riffle]`。`fall=1` の2行は越流の頂部と下端 |
| `scene.json` の `river.bed` | 河床と岸 | `[xCentre, z, halfWidth, bankTopY, toeYWest, toeYEast, earthWest, earthEast, facingWest, facingEast]`。earth=1は土の岸（地形のまま）、0は護岸。facingは護岸の面：0 古い空石積み（天端は苔むした笠石）、1 コンクリートブロック、2 間知石。`walled` は直線の改修区間のz範囲、`leveePath` は東岸の管理用通路の中心線 |
| `scene.json` の `river.drops` | 落差工と固定堰 | 位置・天端高・上下流の水位・水叩きの長さ |
| `scene.json` の `river.canal`・`intake`・`washSteps` | 堰の用水路・取水口・洗い場 | 用水路は `[x, waterY, z, width]`、管渠の区間 |
| `scene.json` の `canals` | 沢から取水する幹線用水路（2本） | 各点 `[x, waterY, z, width, cover]`（cover：0 開水路、1 県道の下の管、2 蓋掛け）。`intake` は沢の取水堰（位置・河床高・天端高・沢の向き）。模型は `architecture/stream-works.glb` に入っている |
| `scene.json` の `streams` | 沢と、田の中の三面張り水路・支線水路 | `kind: "ditch"` は支線水路（沢の上流部 `brook` はない）。`covers` の `kind`：`road` 暗渠、`bridge` 県道の橋の下、`farm`・`levee` 蓋掛け。`water` は水面の帯（各点 `[x, waterY, z, halfWidth]`） |
| `scene.json` の `roads` | 道。`lane-*` は家から道路への小道（未舗装） | 各点 `[x, y, z]` |
| `scene.json` の `hamlets` | 集落の名前と範囲 | 中心z・道沿いの半長 |
| `scene.json` の `objects` の `smoke: true` | 煙を出す家 | 煙の出る位置は `architecture/index.json` の各モデルの `smoke`（ローカル座標） |
| `scene.json` の `powerLine` | 電柱の位置 | 電線は3本、たわみ0.65m |

`asset` 名からGLBへの対応は `src/world/architecture.ts` の `resolve()` と同じ規則です。

- `minka-*` → `<asset>_<variant>.glb`
- `naya` → 番号の偶奇で `naya_0` / `naya_1`
- `toro` → 3つに1つが `toro_1`
- `komainu` → `komainu-a` または `komainu-un`
- `denchu` → 3つに1つが `denchu-trans`
- `prop-*` → `props/` 内のPoly Havenモデル
- `block-wall` と `ishigaki` → 2mのモジュールを `length` に沿って並べる（`ishigaki` は高さ方向に `height` 倍）

次の3つは**ワールド座標のまま**入っています。原点に置いてください。

- `architecture/stairs.glb`：石段・石畳・境内の石垣
- `architecture/road-ditch.glb`：道の側溝と蓋
- `architecture/river-works.glb`：川の護岸・天端・落差工・堰・取水口・用水路・洗い場
- `architecture/stream-works.glb`：沢と支線水路の三面張り・暗渠・蓋、沢から取水する幹線用水路と取水堰

県道が宮沢を渡る短い橋は、`objects` の `road-bridge`（`span`・`width`・`skew`）です。床版の両端は沢に平行（斜橋）で、`road-bridge.glb` は生成時にせん断変形してあります。

石積みの護岸と天端の下は、高さマップでは地面を沈めてあります（1:0.4の壁を1.17m格子で表せないため）。Unityでは `river-works.glb` にMeshColliderを付けるか、`river.bed` から護岸に沿った箱コライダーを作ってください（Three.js版は後者）。

## モデル

| 種類 | ファイル | 内容 |
|---|---|---|
| 建築 | `public/assets/models/architecture/*.glb` | 位置と法線をKHR_mesh_quantizationで量子化。glTFastは対応済み |
| 樹木 | `public/assets/models/trees/<樹種>_<0-3>.glb` | 1ファイルに `_lod0` と `_lod1` の2メッシュ |
| 小物 | `public/assets/models/props/*.glb` | Poly HavenのCC0素材を軽量化したもの。テクスチャを内蔵 |

- 寸法・三角形数は `architecture/index.json` と `trees/trees.json` にあります。家の間口・奥行き・階数・曲り家の翼屋は `tools/architecture/presets.json` です（配置JSONの `wing` は翼屋の衝突判定用の箱で、家のローカル座標）。
- 樹木はLODGroupにし、LOD0とLOD1の切り替え距離（標準45m / 140m）を画面占有率に換算してください。遠景は、Unityで再生成したビルボード（Impostor）を使ってください。
- 樹木の頂点カラー `COLOR_0` は風の重みです。R=幹の揺れ、G=枝のしなり、B=葉の揺れの位相。SpeedTree風の風シェーダーを作る際の入力にしてください。

## 材質

`public/world/materials.json` が唯一の原本です。

- **名前の対応**：GLB内の材質名は、`architecture`・`vegetation`・`terrainLayers` のいずれかに必ず載っています。
- **テクスチャの場所**：`public/assets/textures/<tex>/{albedo,normal,arm}.jpg`。`albedo` だけsRGB、他はリニアで読み込む。
- **arm**：R=AO、G=Roughness、B=Metalness（glTFのORM）。
  - URPのLit / HDRPのMask Mapは R=Metallic、G=AO、A=Smoothness です。チャンネルを並べ替え、Smoothness = 1 − Roughness にしてください。
- **法線**：OpenGL規約（+Y）。Unityも+Yなので、そのまま使えます。
- **size**：テクスチャ1枚が覆う長さ（m）。GLBのUVはメートル単位なので、tiling = 1 / size です。
- **color**：albedoに乗算する色（sRGBの16進）。
- **葉**：アルファカットオフ0.5、両面描画、半透過（HDRPならTranslucent / Subsurface）。
- **saturation**：albedoテクスチャの彩度をどれだけ残すか（1＝写真のまま）。ベージュ色の `white_plaster_rough_01` を白漆喰や灰色のコンクリートとして使うため、彩度を下げてから `color`・`gain` を掛ける。地形の層にも同じ項目がある（林床の `forest_leaves_02`）。
- **dusk**：`[開始時刻, 最大時刻, 最大の発光強度]`。窓明かり・自販機・街灯の発光を時刻で上げる（Unityでは時刻スクリプトから材質のEmissionを制御）。

## 環境（照明の再現）

- **太陽**：`scene.json` の `environment` にある日付・緯度・経度・タイムゾーンで太陽位置を計算する。式は `src/engine/sun.ts`（NOAAの近似式）。
  - 18:00は方位285.6°・高度6.7°。直射光の色は大気減衰の近似で決める（`sunlight()`。18:00で約2900K、線形RGB (1, 0.57, 0.24)）。
  - 直射光と空の光の比は約6:1（`lighting.ts` の `tune`：直射光の強さ15×透過率、環境光0.3、露出1.55）。HDRPではPhysically Based Skyを使わず、この比をDirectional LightのIntensityとSky ExposureでそろえるのがUnity側でも同じ見え方への近道。
- **空**：`public/assets/sky/backdrop.jpg`（上半球のLDR）と `environment_1k.hdr`（Poly Haven `kloppenheim_06_puresky`、CC0）。
  - `sky.json` に元画像の太陽方位がある。空の回転は「太陽方位 − 元画像の太陽方位」。
  - HDRIを環境光に使う場合は、直射光と二重にならないよう太陽部分を抑える（`lighting.ts` では輝度6以上をクランプしている）。
- **霞**：指数関数的な高さフォグ。密度0.00036/m、高さ減衰0.0042/m。太陽方向にHenyey–Greensteinのg=0.72で暖色を加える。HDRPならVolumetric Fogで再現する。
- **トーンマッピング**：ACES。露出は18:00で約1.55。

## 作り直す必要があるもの

草と稲のGPU生成、田の遠景面、川の水面、煙、とんぼ、夕方のチャイム、葉の透過光、風、霞、空のドーム、ポストエフェクト、立体音響は、Three.jsのシェーダーとWeb Audioの実装です。Unity側で同等の表現を作り直してください（Terrain Detail・VFX Graph・水のシェーダー・Audio Mixer）。

Unity化の際も、ヒグラシの録音（CC BY 4.0）のクレジットは必ず表記してください。
