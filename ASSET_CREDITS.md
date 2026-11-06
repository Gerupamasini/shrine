# 使用素材と出典

使用中のファイルは`docs/asset-manifest.json`に相対パス・サイズ・SHA-256を記録しています。無料という理由だけでは取り込みません。Sketchfabの候補モデルは実ファイルや条件を取得・照合できていないため**使用していません**。Kenneyのローポリ素材も使用していません。

| 使用素材 | 入手先・原出典 | 条件・状況 |
|---|---|---|
| Venice Sunset 1k HDRI | [Poly Haven](https://polyhaven.com/a/venice_sunset)、配布ファイル：[pmndrs/drei-assets](https://github.com/pmndrs/drei-assets/blob/master/hdri/venice_sunset_1k.hdr) | Poly Haven CC0。商用・改変・再配布可、表記義務なし。任意クレジット：Poly Haven / HDRI Haven。環境照明に使用し、都市の映る背景としては使用しない |
| Ground048 / Ground103 / Moss002 のColor・NormalGL・Roughness | [GrassSystemThreeJS public](https://github.com/achrefelouafi/GrassSystemThreeJS/tree/b236b2a38d9f35daa2ddc7b0152544b10e635d0c/public) | 配布リポジトリはMIT、©2026 mohamedachrefelouafi。同梱MIT全文を保持。1024² JPGを画質93で再保存。現行描画はGround048を使用、他2セットも再利用用に同梱 |
| 神社・家屋・小物・樹木GLB | 本プロジェクト独自制作 `tools/build-models.mjs` | オリジナル生成物。外部モデルのコピーなし。生成モデル・画像・合成音はCC0で再利用可能 |
| soil/stone/wood/bark/roof/thatch PBR、葉アルファ、水面法線 | 本プロジェクト独自制作 `tools/generate_world.py`、`generate_foliage.py` | オリジナル。土以外の建築・樹皮画像は手続き的生成であり、実写写真ではない |
| summer-insects-synth.wav | 本プロジェクト独自合成 `tools/generate_audio.py` | 53秒、mono PCM16、22050Hz。実録ヒグラシとして扱わない |
| wind-synth.wav、stream-synth.wav | 同上 | 53秒。ノイズから作った音響。現地録音ではない |

Poly Havenの条件は、公式Webサイトのソース`Poly-Haven/polyhaven.com`、コミット`b1a6aa13afc03ae00860f6ac5fe6d5daf8e95356`の`public/locales/en/license.json`を直接照合。`public/assets/licenses/PolyHaven-asset-license.json`に保存しています。CC0により商用利用・改変・再配布が許可されます。

地表セットの配布READMEは「ambientCGの命名規則」と記述します。元のambientCG配布ページには今回アクセスできず、個別ファイルのCC0を一次配布ページで照合したとは主張しません。ここでは実際に取得したGitHubリポジトリのMIT条件と出典を保持します。商用公開前には個別原本との照合を追加してください。元の自動車GLBや参考コードは取り込んでいません。

## ライブラリ

Three.js（MIT）、Vite（MIT）、TypeScript（Apache-2.0）、Rapier JS（Apache-2.0）、Playwright（Apache-2.0）。各パッケージのライセンスはnpmパッケージに含まれます。草・風・建築・地形実装は本プロジェクトの独自コードで、参考リポジトリの実装をコピーしていません。

## 未入手素材

Poly Havenの樹木・草・樹皮、ambientCGの追加写真PBR、Sketchfab建築、Commons/Freesoundの実録ヒグラシは未導入です。候補リストを「実際に使用した素材一覧」へ混ぜていません。これらにクレジット表記を仮置きして使用済みと見せることもしません。
