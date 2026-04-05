以下の TypeScript で書かれた実装は、IndexedDB 上にデータをキャッシュする API を備えたクラスです。

```typescript
import { Asyncmux, asyncmux } from "asyncmux";
import { type IDBPDatabase, openDB } from "idb";
import { tryCaptureStackTrace } from "try-capture-stack-trace";

/**
 * 同期的な値、または Promise ライクな値を表す型です。
 *
 * @template T 解決される値の型です。
 */
export type MaybePromise<T> = T | PromiseLike<T>;

/**
 * キャッシュリーダーを取得する際に渡される引数の型定義です。
 */
export type GetReaderArgs = {
  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * キャッシュからデータを読み出すためのリーダー型です。
 *
 * 同期または非同期の反復子として定義されます。
 */
export type IReader =
  | IterableIterator<Uint8Array<ArrayBuffer>>
  | AsyncIterableIterator<Uint8Array<ArrayBuffer>>;

/**
 * キャッシュライターを取得する際に渡される引数の型定義です。
 */
export type GetWriterArgs = {
  /**
   * サーバーからのレスポンスオブジェクトです。
   */
  response: Response;

  /**
   * 実行されたリクエストオブジェクトです。
   */
  request: Request;

  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * キャッシュへデータを書き込むためのインターフェースです。
 */
export interface IWriter {
  /**
   * チャンクデータを書き込みます。
   */
  write(chunkData: Uint8Array<ArrayBuffer>): MaybePromise<void>;

  /**
   * 書き込みを完了し、リソースを閉じます。
   */
  close(): MaybePromise<void>;

  /**
   * 書き込みを中断します。
   */
  abort(reason: unknown): MaybePromise<void>;
}

/**
 * キャッシュの読み書きを管理するハンドルのインターフェースです。
 */
export interface ICacheHandle {
  /**
   * 指定された条件でキャッシュリーダーを取得します。存在しない場合は null を返します。
   */
  getReader(args: GetReaderArgs): MaybePromise<IReader | null>;

  /**
   * 書き込み用のライターを取得します。
   */
  getWriter(args: GetWriterArgs): MaybePromise<IWriter>;
}

/**
 * ストレージを開始する際に渡せるオプションの型定義です。
 */
export type OpenOptions = {
  /**
   * 中断を監視するためのシグナルです。
   */
  readonly signal?: AbortSignal | undefined;
};

/**
 * ストレージを終了する際に渡せるオプションの型定義です。
 */
export type CloseOptions = {
  /**
   * 中断を監視するためのシグナルです。
   */
  readonly signal?: AbortSignal | undefined;
};

/**
 * ストレージをクリアする際に渡せるオプションの型定義です。
 */
export type ClearOptions = {
  /**
   * キャッシュを一意に識別する文字列です。
   */
  readonly cacheKey?: string | undefined;

  /**
   * 中断を監視するためのシグナルです。
   */
  readonly signal?: AbortSignal | undefined;
};

/**
 * データキャッシュを管理するストレージのインターフェースです。
 */
export interface ICacheStorage {
  /**
   * ストレージが現在開いているかどうかを返します。
   */
  readonly isOpen: boolean;

  /**
   * ストレージを開き、利用可能な状態にします。
   *
   * @param options オプションです。
   */
  open(options?: OpenOptions | undefined): MaybePromise<void>;

  /**
   * ストレージを閉じ、すべてのキャッシュデータを破棄します。
   *
   * @param options オプションです。
   */
  close(options?: CloseOptions | undefined): MaybePromise<void>;

  /**
   * キャッシュをクリアします。引数が指定された場合はそのキーのみ、指定されない場合は全てのキャッシュを削除します。
   *
   * @param cacheKey キャッシュを一意に識別する文字列です。
   * @param options オプションです。
   */
  clear(
    cacheKey?: string | undefined,
    options?: Omit<ClearOptions, "cacheKey"> | undefined,
  ): MaybePromise<void>;

  /**
   * キャッシュをクリアします。引数が指定された場合はそのキーのみ、指定されない場合は全てのキャッシュを削除します。
   *
   * @param options オプションです。
   */
  clear(options?: ClearOptions | undefined): MaybePromise<void>;

  /**
   * 指定したキーに対応するキャッシュハンドルを取得、または新規作成します。
   *
   * @param key キャッシュを一意に識別する文字列です。
   * @returns ICacheHandle を実装したオブジェクトを返します。
   */
  createCacheHandle(key: string): ICacheHandle;
}

/**
 * キャッシュのメタデータ情報を定義する型です。
 */
type Metadata = {
  /**
   * 分割されたチャンクの総数です。
   */
  chunkCount: number;
};

/**
 * キャッシュを一意に識別するためのキーの型です。
 */
type CacheKey = string;

/**
 * IndexedDB のオブジェクトストア構造を定義するスキーマ型です。
 */
type IdbSchema = {
  /**
   * バイナリーデータをチャンク単位で格納するストアです。
   *
   * キーは `${CacheKey}:${number}` の形式です。
   */
  buff: {
    key: `${CacheKey}:${number}`;
    value: Uint8Array<ArrayBuffer>;
  };
  /**
   * 各キャッシュキーに対応するメタデータを格納するストアです。
   */
  meta: {
    key: CacheKey;
    value: Metadata;
  };
};

/**
 * 型定義された IndexedDB データベースのインスタンス型です。
 */
type Idb = IDBPDatabase<IdbSchema>;

/**
 * IndexedDB を開くためのユーティリティー関数です。
 */
const openIdb = openDB<IdbSchema>;

/**
 * 中断理由が設定されていないことを示すための初期値シンボルです。
 */
const NONE = Symbol();

/**
 * 指定された非同期破棄処理を実行する AsyncDisposable オブジェクトを作成します。
 *
 * @param onAsyncDispose 破棄時に実行される非同期関数です。
 * @returns 非同期破棄インターフェースを実装したオブジェクトです。
 */
function defer(onAsyncDispose: () => Promise<void>): AsyncDisposable {
  return { [Symbol.asyncDispose]: onAsyncDispose };
}

/**
 * IndexedDB に対してキャッシュデータの書き込みを行うクラスです。
 */
class IndexedDbCacheWriter implements IWriter {
  /**
   * ストレージ本体への参照です。
   */
  readonly #storage: IndexedDbCacheStorage;

  /**
   * 使用する IndexedDB インスタンスです。
   */
  readonly #db: Idb;

  /**
   * 対象となるキャッシュキーです。
   */
  readonly #cacheKey: string;

  /**
   * 中断された際の理由です。
   */
  #reason: unknown;

  /**
   * ライターが閉じられているかどうかを示すフラグです。
   */
  #isClosed: boolean;

  /**
   * チャンクのカウンターです。
   */
  #chunkCounter = 0;

  /**
   * IndexedDbCacheWriter のインスタンスを初期化します。
   *
   * @param storage 親となるストレージインスタンスです。
   * @param db 操作対象のデータベースです。
   * @param cacheKey キャッシュの識別キーです。
   */
  constructor(storage: IndexedDbCacheStorage, db: Idb, cacheKey: string) {
    this.#storage = storage;
    this.#db = db;
    this.#cacheKey = cacheKey;
    this.#reason = NONE;
    this.#isClosed = false;
    this.#chunkCounter = 0;
  }

  /**
   * インスタンスの状態が有効であるか確認します。
   *
   * ストレージが閉じられている、またはライターが閉じられている場合にエラーを投げます。
   */
  #assertOk(): void {
    // 親ストレージの稼働状態を確認します。
    if (!this.#storage.isOpen) {
      const error = new Error("IndexedDbCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }

    // このライター自体の状態を確認します。
    if (this.#isClosed) {
      // 正常に閉じられたのか、エラーで中断されたのかを判定します。
      if (this.#reason === NONE) {
        const error = new Error("IndexedDbCacheWriter is closed");
        tryCaptureStackTrace(error, this.#assertOk);
        throw error;
      }

      // 中断理由がある場合は、その理由（エラー等）をそのまま投げます。
      throw this.#reason;
    }
  }

  /**
   * チャンクデータを IndexedDB に書き込みます。
   *
   * @param chunkData 書き込むバイナリーデータです。
   */
  @asyncmux
  public async write(chunkData: Uint8Array<ArrayBuffer>): Promise<void> {
    this.#assertOk();

    // インデックスをインクリメントしながら、各チャンクを個別のキーで保存します。
    const index = this.#chunkCounter;
    await this.#db.put("buff", chunkData, `${this.#cacheKey}:${index}`);
    this.#chunkCounter += 1;
  }

  /**
   * 書き込みを完了し、メタデータを保存してライターを閉じます。
   */
  @asyncmux
  public async close(): Promise<void> {
    this.#assertOk();

    // これまでに書き込んだチャンクの総数をメタデータとして保存します。
    const chunkCount = this.#chunkCounter;
    const meta: Metadata = {
      chunkCount,
    };
    await this.#db.put("meta", meta, this.#cacheKey);

    this.#isClosed = true;
    this.#chunkCounter = 0;
  }

  /**
   * 書き込みを中断し、これまでに書き込んだ一時的なチャンクデータを削除します。
   *
   * @param reason 中断した理由です。
   */
  @asyncmux
  public async abort(reason: unknown): Promise<void> {
    this.#assertOk();

    const chunkCount = this.#chunkCounter;

    this.#reason = reason;
    this.#isClosed = true;
    this.#chunkCounter = 0;

    // 書き込まれたチャンクがない場合は削除処理をスキップします。
    if (chunkCount === 0) {
      return;
    }

    // 0 から chunkCount - 1 までの範囲キーを作成し、一括削除します。
    const range = IDBKeyRange.bound(
      `${this.#cacheKey}:0`,
      `${this.#cacheKey}:${chunkCount - 1}`,
    );
    await this.#db.delete("buff", range);
  }
}

/**
 * キャッシュされたデータへのアクセス（読み取り・書き込み）を管理するハンドルクラスです。
 */
class IndexedDbCacheHandle implements ICacheHandle {
  /**
   * 親ストレージへの参照です。
   */
  readonly #storage: IndexedDbCacheStorage;

  /**
   * データベースインスタンスです。
   */
  readonly #db: Idb;

  /**
   * 排他制御用のミューテックスです。
   */
  readonly #mux: Asyncmux;

  /**
   * キャッシュキーです。
   */
  readonly #cacheKey: string;

  /**
   * IndexedDbCacheHandle のインスタンスを初期化します。
   *
   * @param storage ストレージインスタンスです。
   * @param db データベースです。
   * @param mux 同期用オブジェクトです。
   * @param cacheKey キーです。
   */
  public constructor(storage: IndexedDbCacheStorage, db: Idb, mux: Asyncmux, cacheKey: string) {
    this.#storage = storage;
    this.#db = db;
    this.#mux = mux;
    this.#cacheKey = cacheKey;
  }

  /**
   * 親ストレージの状態を確認します。
   */
  #assertOk(): void {
    if (!this.#storage.isOpen) {
      const error = new Error("IndexedDbCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * キャッシュデータを読み取るためのジェネレーターを取得します。
   *
   * @param args 読み取りオプション（Signal 等）です。
   * @returns キャッシュが存在する場合は AsyncGenerator、存在しない場合は null を返します。
   */
  public async getReader(args: GetReaderArgs): Promise<AsyncGenerator<any, void, unknown> | null> {
    const { signal } = args;

    // 読み取りロックを取得します。
    using _1 = await this.#mux.rLock({ signal });

    this.#assertOk();

    // メタデータを取得するために読み取り専用トランザクションを開始します。
    const tx = this.#db.transaction(["meta"], "readonly");

    // 外部からの中断シグナルをトランザクションの中断に連携させます。
    signal?.addEventListener("abort", tx.abort, { once: true });
    await using _2 = defer(async () => {
      signal?.removeEventListener("abort", tx.abort);
    });

    const metaStore = tx.objectStore("meta");
    const meta = await metaStore.get(this.#cacheKey);

    // キャッシュ（メタデータ）が存在しない場合は null を返して終了します。
    if (!meta) {
      return null;
    }

    const db = this.#db;
    const storage = this.#storage;
    const cacheKey = this.#cacheKey;
    const { chunkCount } = meta;

    /**
     * 実際のチャンク読み取りを行う内部非同期ジェネレーターです。
     */
    async function* createReader() {
      // チャンク取得用のトランザクションを開始します。
      const tx = db.transaction(["buff"], "readonly");
      const buffStore = tx.objectStore("buff");

      for (let index = 0; index < chunkCount; index++) {
        // 読み取りの途中でストレージが閉じられていないか毎ステップ確認します。
        if (!storage.isOpen) {
          throw new Error("IndexedDbCacheStorage is closed");
        }

        const chunk = await buffStore.get(`${cacheKey}:${index}`);
        if (!chunk) {
          throw new Error(`Missing chunk at index ${index}`);
        }

        yield chunk;
      }
    }

    return createReader();
  }

  /**
   * キャッシュにデータを書き込むためのライターを取得します。
   *
   * @param args 書き込みオプションです。
   * @returns IWriter インターフェースを実装したライターインスタンスです。
   */
  public async getWriter(args: GetWriterArgs): Promise<IWriter> {
    const { signal } = args;

    // 書き込みの排他制御のためにロックを取得します。
    using _1 = await this.#mux.rLock({ signal });

    this.#assertOk();

    return new IndexedDbCacheWriter(this.#storage, this.#db, this.#cacheKey);
  }
}

/**
 * IndexedDB をバックエンドとしたキャッシュストレージの実装クラスです。
 */
export default class IndexedDbCacheStorage implements ICacheStorage, AsyncDisposable {
  /**
   * データベース接続インスタンスです。閉じられているときは null になります。
   */
  #db: Idb | null;

  /**
   * クラス全体での非同期操作の整合性を保つためのミューテックスです。
   */
  readonly #mux: Asyncmux;

  /**
   * 使用する IndexedDB のデータベース名です。
   */
  readonly #dbName: string;

  /**
   * IndexedDbCacheStorage のインスタンスを初期化します。
   *
   * @param dbName データベース名です。指定されない場合はデフォルト名が使用されます。
   */
  public constructor(dbName: string | undefined) {
    this.#db = null;
    this.#mux = new Asyncmux();
    this.#dbName = dbName ?? "dl-once";
  }

  /**
   * 接続が有効であるか確認します。
   */
  #assertOk(): void {
    if (!this.isOpen) {
      const error = new Error("IndexedDbCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * ストレージが開いているかどうかを返します。
   */
  public get isOpen(): boolean {
    return !!this.#db;
  }

  /**
   * データベースを開き、初期化を行います。
   *
   * @param options オープン時のオプション（Signal 等）です。
   */
  public async open(options: OpenOptions | undefined = {}): Promise<void> {
    const { signal } = options;

    // 二重オープンを防止するためロックを取得します。
    using _ = await this.#mux.lock({ signal });

    if (this.#db) {
      throw new Error("Storage is already open");
    }

    // データベースを開き、必要に応じてオブジェクトストアを作成します。
    this.#db = await openIdb(this.#dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
        if (!db.objectStoreNames.contains("buff")) {
          db.createObjectStore("buff");
        }
      },
    });
  }

  /**
   * データベース接続を閉じます。
   *
   * @param options クローズ時のオプションです。
   */
  public async close(options: CloseOptions | undefined = {}): Promise<void> {
    const { signal } = options;

    using _ = await this.#mux.lock({ signal });

    this.#assertOk();

    this.#db!.close();
    this.#db = null;
  }

  /**
   * `using` 構文等で利用される非同期破棄メソッドです。
   *
   * 接続が開いている場合は閉じます。
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    using _ = await this.#mux.lock();

    this.#db?.close();
    this.#db = null;
  }

  /**
   * キャッシュされたデータを削除します。
   *
   * 引数の組み合わせにより、特定のキーの削除または全削除を行います。
   */
  public clear(
    cacheKey?: string | undefined,
    options?: Omit<ClearOptions, "cacheKey"> | undefined,
  ): Promise<void>;

  public clear(options?: ClearOptions | undefined): Promise<void>;

  public async clear(
    cacheKeyOrOptions?: string | ClearOptions | undefined,
    options: Omit<ClearOptions, "cacheKey"> | undefined = {},
  ): Promise<void> {
    // 引数の型に応じてオプションを正規化します。
    const {
      signal,
      cacheKey,
    } = typeof cacheKeyOrOptions === "object"
      ? cacheKeyOrOptions
      : {
        ...options,
        cacheKey: cacheKeyOrOptions,
      };

    // 削除操作の整合性を保つためロックを取得します。
    using _1 = await this.#mux.lock({ signal });

    this.#assertOk();

    // 読み書きトランザクションを開始します。
    const tx = this.#db!.transaction(["buff", "meta"], "readwrite");
    signal?.addEventListener("abort", tx.abort, { once: true });

    // トランザクション完了の待機とイベントリスナーの解除を行います。
    await using _2 = defer(async () => {
      try {
        await tx.done;
      } finally {
        signal?.removeEventListener("abort", tx.abort);
      }
    });

    if (cacheKey !== undefined) {
      // 特定のキャッシュキーのみを削除する場合のロジックです。
      const metaStore = tx.objectStore("meta");
      const meta = await metaStore.get(cacheKey);
      if (!meta) {
        return;
      }

      // まずメタデータを削除します。
      await metaStore.delete(cacheKey);

      const { chunkCount } = meta;
      const buffStore = tx.objectStore("buff");

      // チャンク数に応じて削除戦略を切り替えます。
      if (chunkCount === 0) {
        // 削除するバッファーはありません。
      } else if (chunkCount === 1) {
        // チャンクが 1 つだけなら直接削除します。
        await buffStore.delete(`${cacheKey}:0`);
      } else {
        // チャンクが複数あるなら、範囲指定で一括削除します。
        const keyRange = IDBKeyRange.bound(
          `${cacheKey}:0`,
          `${cacheKey}:${chunkCount - 1}`,
        );
        await buffStore.delete(keyRange);
      }
    } else {
      // キャッシュキーが指定されていない場合は、すべてのストアの内容を消去します。
      const metaStore = tx.objectStore("meta");
      await metaStore.clear();
      const buffStore = tx.objectStore("buff");
      await buffStore.clear();
    }
  }

  /**
   * 指定したキーに対するキャッシュ操作ハンドルを作成します。
   *
   * @param key キャッシュキーです。
   * @returns キャッシュハンドルインスタンスです。
   */
  public createCacheHandle(key: string): ICacheHandle {
    this.#assertOk();

    return new IndexedDbCacheHandle(this, this.#db!, this.#mux, key);
  }
}
```

上記の TypeScript で書かれた実装は、IndexedDB 上にデータをキャッシュする API を備えたクラスです。このクラスを参考に、IndexedDB 上ではなく `node:fs` でファイルシステムににキャッシュに保存するようにしたクラス `NodeFsCacheStorage` を実装してください。
