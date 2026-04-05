import { tryCaptureStackTrace } from "try-capture-stack-trace";
import type { ClearOptions, CloseOptions, ICacheStorage, OpenOptions } from "./cache-storage.js";
import type { GetReaderArgs, GetWriterArgs, ICacheHandle, IWriter } from "./dl-once.js";

/**
 * 中断理由が設定されていないことを示すための初期値シンボルです。
 */
const NONE = Symbol();

/**
 * メモリーキャッシュへの書き込みを担当するクラスです。
 *
 * データのチャンクを一時的に蓄積し、完了時にストレージへ保存します。
 */
class MemoryCacheWriter implements IWriter {
  /**
   * 参照先のメモリーキャッシュストレージです。
   */
  readonly #storage: MemoryCacheStorage;

  /**
   * 書き込み完了時に実行されるコールバック関数です。
   */
  #onComplete: (data: Uint8Array<ArrayBuffer>[]) => void;

  /**
   * 書き込まれたバイナリーデータのチャンクを保持する配列です。
   */
  #buffer: Uint8Array<ArrayBuffer>[];

  /**
   * 書き込みが中断（abort）された際の理由を保持します。
   */
  #reason: unknown;

  /**
   * ライターが閉じられたかどうかを管理するフラグです。
   */
  #isClosed: boolean;

  /**
   * MemoryCacheWriter の新しいインスタンスを生成します。
   *
   * @param storage 関連付けられたメモリーキャッシュストレージです。
   * @param onComplete 書き込み成功時にチャンク配列を受け取るコールバックです。
   */
  constructor(
    storage: MemoryCacheStorage,
    onComplete: (buffer: Uint8Array<ArrayBuffer>[]) => void,
  ) {
    this.#storage = storage;
    this.#onComplete = onComplete;
    this.#buffer = [];
    this.#reason = NONE;
    this.#isClosed = false;
  }

  /**
   * このインスタンスが利用可能かどうかを確認します。
   */
  #assertOk(): void {
    // ストレージ本体が有効であることを確認します。
    if (!this.#storage.isOpen) {
      const error = new Error("MemoryCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }

    // ライターがクローズまたはアボート済みでないか確認します。
    if (this.#isClosed) {
      // 異常終了（abort）している場合はその理由を、正常終了している場合は標準エラーを投げます。
      if (this.#reason === NONE) {
        const error = new Error("MemoryCacheWriter is closed");
        tryCaptureStackTrace(error, this.#assertOk);
        throw error;
      }

      throw this.#reason;
    }
  }

  /**
   * データのチャンクを内部バッファーに書き込みます。
   *
   * @param chunkData 書き込むバイナリーデータです。
   */
  public write(chunkData: Uint8Array<ArrayBuffer>): void {
    this.#assertOk();

    // メモリー上の配列にチャンクを追加します。
    this.#buffer.push(chunkData);
  }

  /**
   * 書き込みを正常に終了し、蓄積されたデータを確定させます。
   */
  public close(): void {
    this.#assertOk();

    // 蓄積した全チャンクをコールバックに渡し、キャッシュとして確定させます。
    this.#onComplete(this.#buffer);

    this.#onComplete = () => {};
    this.#buffer = [];
    this.#isClosed = true;
  }

  /**
   * 書き込みを中断し、蓄積されたデータを破棄します。
   *
   * @param reason 中断した理由（エラーオブジェクトなど）です。
   */
  public abort(reason: unknown): void {
    this.#assertOk();

    // 蓄積していたバッファーを直ちに解放します。
    this.#buffer = [];
    this.#reason = reason;
    this.#isClosed = true;
  }
}

/**
 * 特定のキーに対応するキャッシュデータを操作するためのハンドルです。
 */
class MemoryCacheHandle implements ICacheHandle {
  /**
   * 親となるストレージインスタンスです。
   */
  readonly #storage: MemoryCacheStorage;

  /**
   * キャッシュされたバイナリーデータのリストです。まだデータがない場合は null です。
   */
  #buffer: Uint8Array<ArrayBuffer>[] | null;

  /**
   * MemoryCacheHandle の新しいインスタンスを生成します。
   *
   * @param storage 関連付けられたメモリーキャッシュストレージです。
   */
  public constructor(storage: MemoryCacheStorage) {
    this.#storage = storage;
    this.#buffer = null;
  }

  /**
   * このインスタンスが利用可能かどうかを確認します。
   */
  #assertOk(): void {
    // ストレージ本体が有効であることを確認します。
    if (!this.#storage.isOpen) {
      const error = new Error("MemoryCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * キャッシュされたデータをクリアします。
   */
  public clear(): void {
    this.#assertOk();

    this.#buffer = null;
  }

  /**
   * キャッシュされたデータを読み取るためのイテレーターを取得します。
   *
   * @returns データのチャンクを順次返すイテレーターを返します。キャッシュがない場合は null を返します。
   */
  public getReader(args: GetReaderArgs): Generator<Uint8Array<ArrayBuffer>, void, unknown> | null {
    const { signal } = args;

    signal?.throwIfAborted();

    this.#assertOk();

    // まだ書き込みが完了していない（キャッシュデータがない）場合は null を返して終了します。
    if (!this.#buffer) {
      return null;
    }

    const buffer = this.#buffer;
    const storage = this.#storage;

    function* createReader() {
      // 保存されているチャンクを順番に yield します。
      for (const chunk of buffer) {
        // 読み取り中にストレージが破棄されていないか確認します。
        if (!storage.isOpen) {
          throw new Error("MemoryCacheStorage is closed");
        }

        yield chunk;
      }
    }

    return createReader();
  }

  /**
   * キャッシュにデータを書き込むためのライターを生成します。
   *
   * @returns IWriter インターフェースを実装したライターオブジェクトを返します。
   */
  public getWriter(args: GetWriterArgs): MemoryCacheWriter {
    const { signal } = args;

    signal?.throwIfAborted();

    this.#assertOk();

    // ライターが close されたときに、このハンドル内の #buffer にデータがセットされるようにします。
    return new MemoryCacheWriter(this.#storage, buffer => {
      this.#buffer = buffer;
    });
  }
}

/**
 * メモリー上でのデータキャッシュを管理するストレージクラスです。
 *
 * Map を使用してキーごとにキャッシュハンドルを保持します。
 */
export default class MemoryCacheStorage implements ICacheStorage, Disposable {
  /**
   * キャッシュキーとハンドルの対応を保持する内部マップです。
   *
   * ストレージが閉じているときは null になります。
   */
  #store: Map<string, MemoryCacheHandle> | null = null;

  /**
   * このインスタンスが利用可能かどうかを確認します。
   */
  #assertOk(): void {
    // ストレージ本体が有効であることを確認します。
    if (!this.isOpen) {
      const error = new Error("MemoryCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * ストレージが現在開いているかどうかを返します。
   */
  public get isOpen(): boolean {
    return !!this.#store;
  }

  /**
   * ストレージを開き、利用可能な状態にします。
   */
  public open(options: OpenOptions | undefined = {}): void {
    const { signal } = options;

    signal?.throwIfAborted();

    if (this.#store) {
      throw new Error("Storage is already open");
    }

    this.#store = new Map();
  }

  /**
   * ストレージを閉じ、すべてのキャッシュデータを破棄します。
   */
  public close(options: CloseOptions | undefined = {}): void {
    const { signal } = options;

    signal?.throwIfAborted();

    this.#assertOk();

    // メモリ解放のためマップをクリアし、null を代入します。
    this.#store!.clear();
    this.#store = null;
  }

  /**
   * Explicit Resource Management (Using 構文) をサポートするための破棄メソッドです。
   */
  public [Symbol.dispose](): void {
    // 既に閉じられている可能性を考慮し、オプショナルチェイニングを使用してクリアします。
    this.#store?.clear();
    this.#store = null;
  }

  /**
   * キャッシュをクリアします。引数が指定された場合はそのキーのみ、指定されない場合は全てのキャッシュを削除します。
   *
   * @param cacheKey キャッシュを一意に識別する文字列です。
   */
  public clear(
    cacheKey?: string | undefined,
    options?: Omit<ClearOptions, "cacheKey"> | undefined,
  ): void;

  public clear(options?: ClearOptions | undefined): void;

  public clear(
    cacheKeyOrOptions?: string | ClearOptions | undefined,
    options: Omit<ClearOptions, "cacheKey"> | undefined = {},
  ): void {
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
    signal?.throwIfAborted();

    this.#assertOk();

    const store = this.#store!;

    if (cacheKey !== undefined) {
      const handle = store.get(cacheKey);
      if (handle) {
        handle.clear();
        store.delete(cacheKey);
      }
    } else {
      // 全てのハンドルのデータをクリアしてから Map を空にする
      for (const handle of store.values()) {
        handle.clear();
      }

      store.clear();
    }
  }

  /**
   * 指定したキーに対応するキャッシュハンドルを取得、または新規作成します。
   *
   * @param key キャッシュを一意に識別する文字列です。
   * @returns ICacheHandle を実装したオブジェクトを返します。
   */
  public createCacheHandle(key: string): ICacheHandle {
    this.#assertOk();

    const store = this.#store!;

    // 既にハンドルが存在すればそれを返し、なければ新規作成してストアに登録します。
    let handle = store.get(key);
    if (!handle) {
      handle = new MemoryCacheHandle(this);
      store.set(key, handle);
    }

    return handle;
  }
}
