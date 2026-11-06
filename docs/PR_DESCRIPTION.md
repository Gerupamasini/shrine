## 変更内容

空のリポジトリに、Three.js・TypeScript・Viteによる日本の山村と神社の探索環境を追加します。麓から200段を登って境内・展望地点へ移動でき、村、水田、川を一人称で歩けます。

- Rapierによる歩行・衝突、時刻17〜19時、画質、撮影用カメラ、位置に応じた合成環境音。
- GLB、16-bit高さマップ、地表マスク、658件の配置JSON、道路・川データ、独立PBR画像、ライセンス一覧とUnity移植手順。
- 標準画質の目安を150万三角形・250 draw callsに設定。展望地点で約95万三角形・105 callsを観測。
- GitHub Pages用の`/shrine/`ビルドと公開Actions。素材URLもViteのbaseに追従。PRでは検証だけ、mainへのマージ後に公開。

## 検証

- `npm ci --no-audit --no-fund`
- `npm test`：7件成功
- `npm run build`、`npm run build:pages`
- Playwright探索シナリオ：登頂・下山・壁衝突・設定・音声読込・小画面表示が成功
- 本番スモーク：実WASD入力、時刻、フリーカメラ復帰、村・川の描画

スクリーンショットと検証記録は`artifacts/`、`docs/VALIDATION.md`に同梱。

## 公開と残作業

GitHubのSettings → PagesでSourceをGitHub Actionsに設定してください。mainへのマージ後、公開先は https://gerupamasini.github.io/shrine/ を想定しています。

現状は探索可能な制作版で、依頼の写実性を満たす最終完成品ではありません。建築・植生は独自生成GLB、音は合成で、実録ヒグラシ・高品質な実樹木・建築素材の追加が残っています。地表素材の元配布ページとのライセンス照合と、実機GPUでの1080p・60fps測定も残作業です。詳細はREADMEとASSET_CREDITS.mdを参照。
