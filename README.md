# dl-once

`dl-once` は、リソースを「一度だけ、確実に」取得するための TypeScript/JavaScript ライブラリです。

ネットワークの不安定さへの耐性、多層的なキャッシュ制御、そして詳細なライフサイクルフックを提供し、複雑なダウンロード要件をシンプルに解決します。

## 主な特徴

* **キャッシュファースト**: ネットワーク取得の前にキャッシュ（IndexedDB、ファイルシステム 等）を確認し、無駄な通信を抑制します。
* **マルチターゲット・フォールバック**: 複数の URL を指定可能。1つ目の取得に失敗しても、自動的に次のミラーサイトやバックアップ URL を試行します。
* **ストリーム処理**: メモリ効率を重視。レスポンスをチャンクごとに処理し、読み込みながら同時にキャッシュへの書き出しを行います。
* **強力なフックシステム**: 開始前、データ受信中、完了、エラーの各フェーズに独自のロジックを注入できます。
* **中断（Abort）の完全サポート**: `AbortSignal` により、処理を安全かつ即座に停止し、リソースを解放します。

## インストール

```bash
npm install dl-once
```

## 基本的な使い方

最もシンプルな使い方は、URL を渡して `Uint8Array` を受け取る方法です。

```typescript
import downloadOnce from "dl-once";

const data = await downloadOnce("https://example.com/assets/config.bin");
console.log(`取得サイズ: ${data.length} bytes`);
```

## 高度な設定例（1）

キャッシュ、検証を組み合わせる例です。

```typescript
import {
  downloadOnce,           // メインの関数です。
  IndexedDbCacheStorage,  // ブラウザーで IndexedDB にキャッシュするためのストレージクラスです。
  NodeFsCacheStorage,     // Node.js でファイルにキャッシュするためのストレージクラスです。
  Sha256VerificationHook, // 期待する SHA-256 ハッシュ値であるか検証するためのフッククラスです。
} from "dl-once";

await using cacheStorage = typeof document !== "undefined"
  ? new IndexedDbCacheStorage("dl-once-db-name")
  : new NodeFsCacheStorage("/tmp/dl-once-cache");
await cacheStorage.open();

const data = downloadOnce(["https://example.com/data"], {
  // キャッシュの制御
  cacheHandle: cacheStorage.createCacheHandle(),

  // ライフサイクルフック
  hooks: [
    new Sha256VerificationHook("..."),
  ],

  // 中断制御
  signal: AbortSignal.timeout(30e3) // 30 秒タイムアウト
});
```

## 高度な設定例（2）

キャッシュ、カスタムフェッチャー、および進捗確認用のフックを組み合わせる例です。

```typescript
import downloadOnce from "dl-once";

const data = await downloadOnce(
  // 1つ目が失敗したら2つ目を試行
  ["https://primary.example.com/data", "https://backup.example.com/data"],
  {
    // キャッシュの制御
    cacheHandle: myCustomCacheHandle, 
    forceDownload: false,

    // ライフサイクルフック
    hooks: [{
      onBeforeDownload({ request }) {
        console.log(`開始: ${request.url}`);
      },
      onChunkRead({ chunkData }) {
        console.log(`${chunkData.length} bytes を受信`);
      },
      onClose() {
        console.log("ダウンロード完了！");
      },
      onError({ reason }) {
        console.error("エラーが発生しました:", reason);
      }
    }],

    // 中断制御
    signal: AbortSignal.timeout(30e3) // 30 秒タイムアウト
  }
);
```

## API リファレンス

### `downloadOnce(target, options?)`

#### `target`

取得対象を指定します。以下のいずれか、またはその配列を受け取ります。

* `string` | `URL` | `Request`: リソースの場所。
* `() => MaybePromise<PrimitiveTarget>`: 実行時に URL を生成する関数。
* `Config`: 個別の設定（`target`, `hooks`, `fetcher` 等）を含むオブジェクト。

#### `options`

全体的な動作を制御するオプションです。

* `cacheHandle`: キャッシュの読み書きを管理するインターフェース。
* `forceDownload`: `true` の場合、キャッシュを無視してネットワークから取得します。
* `hooks`: グローバルに適用されるフック関数の配列。
* `fetcher`: カスタムの HTTP リクエスト実行関数（デフォルトは `fetch`）。
* `signal`: 処理全体を中断するための `AbortSignal`。

## インターフェースの拡張

### キャッシュの実装 (`ICacheHandle`)

独自のキャッシュ機構（例：ブラウザの Cache Storage や Node.js のファイルシステム）を利用するには、`ICacheHandle` を実装します。

```typescript
const myCache: ICacheHandle = {
  async getReader({ signal }) {
    // キャッシュがあれば AsyncIterableIterator を返す、なければ null
  },
  async getWriter({ response, request }) {
    // IWriter (write, close, abort) を実装したオブジェクトを返す
  }
};
```

### フックの実装 (`IHook`)

ダウンロードの進捗表示やログ記録などに利用できます。特定のフックがエラーを投げても、ライブラリ本体の処理は継続されるよう設計されています（`onClose` を除く）。

## ライセンス

MIT
