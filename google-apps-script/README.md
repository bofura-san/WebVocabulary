# Google Apps Script の設定

1. スプレッドシートを開き、[`publish.gs`](/C:/Users/afflu/Dropbox/WebVocabulary/google-apps-script/publish.gs) の内容を Apps Script に貼り付けて紐付けます。
2. 次のスクリプトプロパティを設定します。
   `GITHUB_OWNER`
   `GITHUB_REPO`
   `GITHUB_BRANCH` 任意、未設定時は `main`
   `GITHUB_TOKEN`
   `WV_DATA_BASE_PATH` 任意、未設定時は `data`
   `WV_DEFAULT_GID` 任意、未設定時は `LST_GID` の最初のデータ行
   `WV_LIST_GID` 任意、未設定時は `1137954113`
3. 最初に一度 `initializeListSheetMetadata` を実行します。
4. 以後、各単語シートを編集すると、`LST_GID` の該当行の `hash` は空欄になり、`更新` 列は `要更新` になります。
5. スプレッドシートのメニューから `更新 -> GitHubへ反映` を実行すると、JSON を再生成して `data/list.json` と `data/sheets/*.json` を GitHub にアップロードします。

これで Web アプリは、毎回 Google Sheets の CSV を取りに行く代わりに、GitHub Pages 上の静的 JSON を読み込めるようになります。
