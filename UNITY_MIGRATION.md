# Unity移植

## 共有データ

- `public/assets/models/*.glb`：建築・小物は独自制作、樹木はMITのEZ Tree派生。メートル・Y-up。原本は`tools/build-models.mjs`と`tools/build-trees.mjs`。Blenderのファイルを原本としているとは主張しない。
- `public/assets/*-{albedo,normal,roughness}.*`：独立したオリジナルPBR画像。
- `public/assets/pbr/`：外部PBR。`ASSET_CREDITS.md`と同梱ライセンスを保持。
- `public/assets/venice_sunset_1k.hdr`：CC0の環境照明。背景は日本の景観を保つため動的な空を使用する。
- `public/assets/audio/`：自作合成PCM。実録ヒグラシではない。
- `public/world/scene.json`：固定シード、全配置、200段の寸法・位置、水田区画、時刻、負荷予算。
- `heightmap.r16`：ヘッダーなし、513×513、uint16 little endian、row-major。
- `heightmap.png`：同じ16-bit値を持つ確認用PNG。8-bitへ変換しない。
- `surface-mask.png`：RGB。R=低地の土/草、G=森林斜面、B=参道/境内。3つの重みを必要に応じて正規化する。写真による植生分布の測量データではない。
- `materials.json`：モデル内の材質名と外部テクスチャ・色・パラメータの対応。

## 座標

Three.jsは右手系、+Yが上、カメラ正面は-Z。Unityは左手系、+Yが上、カメラ正面は+Z。1単位=1mを共通にする。

配置位置は`(x,y,z) → (x,y,-z)`。JSONの回転はXYZ順のラジアン。現在の配置はY回転のみなのでUnityでは`Quaternion.Euler(0,-yaw*Rad2Deg,0)`。一般のクォータニオンでは`(qx,qy,qz,qw) → (-qx,-qy,qz,qw)`。glTFインポーターが行うモデル内部の座標変換と、配置座標の変換を重複させない。配置スケールは正のXYZ値。

glTFastなどのglTF 2.0インポーターを使用する。FBXへ変換する場合はBlenderにGLBを読み、単位・適用スケール・マテリアル名・ピボットを確認してから書き出す。全シーンを一つの巨大なGLBに固めない。

## Unity Terrain

1. TerrainDataのheightmapResolutionを513にする。
2. `size = (1200,256,1200)`、Terrainオブジェクト位置を`(-600,-8,-600)`にする。
3. RAWをlittle endianの16-bitとして読み、値を`65535f`で割る。
4. 元データrow0はThree.jsのz=-600。Z反転後のUnityではz=+600となるため、Unityの`heights[row,col]`へ入れるときは行を反転する。
5. `SetHeights(0,0,heights)`を実行する。マスク画像も同じ向きで読み、TerrainLayerへ割り当てる。
6. 村の川底は高さマップに含まれる。水面・護岸・橋は別メッシュとして再構築する。

高さの復元式は`y = raw/65535*256-8`。OpenGLテクスチャの上下反転と、地形配列のZ反転を混同しない。

## 地形とは別の構造物

参道は4フライト×50段、蹴上げ0.19m、踏面0.48m、幅5.4m、踊り場3m。JSONの各段を使って石段を生成し、接触用には各フライトの連続した斜面を別途作る。200個の細かい段差をCharacterControllerへ直接ぶつけない。境内床はy=38m。木の幹は円柱、建物は単純なボックスを基本とし、屋根や葉にメッシュ衝突を付けない。

LOD0/1/2は別GLB。LODGroupを作り、元の距離を画面占有率へ調整する。GLBの材質名を`materials.json`と照合し、URP Lit/HDRP Litに外部画像を割り当てる。albedoだけsRGB、法線・roughnessは線形。Unityではsmoothness=1-roughnessへ変換し、使用するレンダーパイプラインのmask channelへパックする。法線の緑チャンネルは選択インポーターの規約をテストして決める。

## エンジンごとに再実装するもの

Sky、ACES露出、太陽・環境光、霧、葉の風、水面法線スクロール、Web Audioの距離減衰、Rapierの歩行、UIをそのまま移植しない。JSONの環境パラメータを基準にUnity側で調整する。HDRIと太陽の二重照明に注意。現在は天文学的な日時計算ではなく、17〜19時の美術調整である。

樹木はEZ Treeの3D分岐と外部の葉・樹皮画像。スギ・ヒノキの正確な樹種モデル、風化した神社の写真モデル、実録ヒグラシは未導入。ライセンスが検証できた素材に差し替える場合、材質名とモデルの接地ピボットを保ち、GLB寸法・衝突サイズ・負荷予算を再検証する。

## 再構築版の追加データ

- 地形は下流方向へ下がる川、水平な56区画の水田、水田より1.15m高い宅地を先に決めてから造成。`tools/generate_world.py`が原本。
- 家屋・納屋・神社の`-low.glb`は建築用LOD。Three.js標準では75mで切替。
- 近景の樹木は32m、中景105m、遠景410mの3段階。大きさと視野角でUnityのLODGroup閾値を調整。
- `assets/botanical/*-impostor.png`は遠景専用。元の3D形状は同梱GLB。`impostors.json`にベイク時の寸法。UnityではSpeedTree相当のビルボードや別のインポスターへ置換可能。
- 葉はalpha clip 0.35、両面。樹皮は法線・roughness・色を別画像で保持。MIT本文と出典を一緒に移植する。
- 遠景樹冠11,000本の位置・回転・スケール・線形RGBは`public/world/canopy.json`。原本は`tools/generate-canopy.mjs`。Three.jsはこのJSONを読み込むため、Unityへも同じ配置を移せる。遠景用の平面は1×1m、原点が底辺中央、3枚をY軸回転0/60/120度で交差させる。近づいたときの立体モデルへの切替は遠景樹冠では未実装。
