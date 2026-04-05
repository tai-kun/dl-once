import { Asyncmux, asyncmux } from "asyncmux";
import { tryCaptureStackTrace } from "try-capture-stack-trace";
import type { ClearOptions, CloseOptions, ICacheStorage, OpenOptions } from "./cache-storage.js";
import type { GetReaderArgs, GetWriterArgs, ICacheHandle, IWriter } from "./dl-once.js";

/**
 * 動的にインポートされる Node.js 標準モジュールを保持するオブジェクトです。
 */
const modules = {} as {
  fs: typeof import("node:fs/promises");
  path: typeof import("node:path");
};

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
 * 中断理由が設定されていないことを示すための初期値シンボルです。
 */
const NONE = Symbol("NONE");

/**
 * ベースディレクトリーとキャッシュキーから、安全なキャッシュディレクトリーのパスを計算します。
 *
 * @param baseDir ベースとなるディレクトリーのパスです。
 * @param cacheKey キャッシュを一意に識別するキーです。
 * @returns 計算されたフルパスです。
 */
function getCacheDir(baseDir: string, cacheKey: string): string {
  const { path } = modules;

  // キャッシュキー自体にディレクトリー区切り文字が含まれるのを防ぎます。
  if (cacheKey.includes(path.sep)) {
    throw new Error(`Invalid cacheKey: "${cacheKey}". Path separators are not allowed.`);
  }

  // フルパスを解決し、ベースディレクトリー配下に収まっているかを検証します（パストラバーサル対策）。
  const fullPath = path.resolve(baseDir, cacheKey);
  const relative = path.relative(baseDir, fullPath);
  const isOutside = relative.startsWith("..");
  if (isOutside) {
    throw new Error("Security Error: The generated path is outside of the base directory.");
  }

  return fullPath;
}

/**
 * Node.js のファイルシステムを使用してキャッシュを書き込むクラスです。
 */
class NodeFsCacheWriter implements IWriter {
  /**
   * ストレージの本体です。
   */
  readonly #storage: NodeFsCacheStorage;

  /**
   * 書き込み先のキャッシュディレクトリーです。
   */
  readonly #cacheDir: string;

  /**
   * 中断された際の原因です。
   */
  #reason: unknown;

  /**
   * ライターが閉じられたかどうかを管理するフラグです。
   */
  #isClosed: boolean;

  /**
   * 書き込まれたチャンクの数をカウントします。
   */
  #chunkCounter: number;

  /**
   * インスタンスを初期化します。
   *
   * @param storage 所属するストレージインスタンスです。
   * @param cacheDir 書き込み対象のディレクトリーパスです。
   */
  constructor(storage: NodeFsCacheStorage, cacheDir: string) {
    this.#storage = storage;
    this.#cacheDir = cacheDir;
    this.#reason = NONE;
    this.#isClosed = false;
    this.#chunkCounter = 0;
  }

  /**
   * インスタンスの状態が正常（オープンかつ未閉鎖）であることを確認します。
   */
  #assertOk(): void {
    if (!this.#storage.isOpen) {
      const error = new Error("NodeFsCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }

    if (this.#isClosed) {
      if (this.#reason === NONE) {
        const error = new Error("NodeFsCacheWriter is closed");
        tryCaptureStackTrace(error, this.#assertOk);
        throw error;
      }

      // 中断理由がある場合は、その理由をそのまま投げます。
      throw this.#reason;
    }
  }

  /**
   * チャンクデータをファイルとして書き込みます。
   *
   * @param chunkData 書き込むデータです。
   * @returns 書き込み完了を示すプロミスです。
   */
  @asyncmux
  public async write(chunkData: Uint8Array<ArrayBuffer>): Promise<void> {
    const { fs, path } = modules;

    this.#assertOk();

    // 現在のカウンター値をインデックスとしてファイル名（0.bin, 1.bin...）を決定します。
    const index = this.#chunkCounter;
    const chunkPath = path.join(this.#cacheDir, `${index}.bin`);

    // データをファイルに永続化し、カウンターをインクリメントします。
    await fs.writeFile(chunkPath, chunkData);
    this.#chunkCounter += 1;
  }

  /**
   * 書き込みを完了し、メタデータファイルを生成してライターを閉じます。
   *
   * @returns 完了を示すプロミスです。
   */
  @asyncmux
  public async close(): Promise<void> {
    const { fs, path } = modules;

    this.#assertOk();

    // 書き込まれた総チャンク数をメタデータとして保存します。
    const chunkCount = this.#chunkCounter;
    const meta: Metadata = {
      chunkCount,
    };
    const metaPath = path.join(this.#cacheDir, "meta.json");
    await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");

    // 内部状態を更新して、以降の操作を受け付けないようにします。
    this.#isClosed = true;
    this.#chunkCounter = 0;
  }

  /**
   * 書き込みを中断し、これまでに書き込んだ不完全なチャンクファイルを削除します。
   *
   * @param reason 中断した理由（エラーオブジェクトなど）です。
   * @returns 中断処理完了を示すプロミスです。
   */
  @asyncmux
  public async abort(reason: unknown): Promise<void> {
    const { fs, path } = modules;

    this.#assertOk();

    const chunkCount = this.#chunkCounter;
    this.#reason = reason;
    this.#isClosed = true;
    this.#chunkCounter = 0;

    // まだ何も書き込まれていない場合は削除処理をスキップします。
    if (chunkCount === 0) {
      return;
    }

    // 全てのチャンクファイルを走査して削除します。
    for (let index = 0; index < chunkCount; index++) {
      const chunkPath = path.join(this.#cacheDir, `${index}.bin`);
      await fs.rm(chunkPath, { force: true });
    }
  }
}

/**
 * 特定のキャッシュキーに対する読み書きを管理するハンドルクラスです。
 */
class NodeFsCacheHandle implements ICacheHandle {
  /**
   * 親ストレージインスタンスです。
   */
  readonly #storage: NodeFsCacheStorage;

  /**
   * 排他制御用のミューテックスです。
   */
  readonly #mux: Asyncmux;

  /**
   * 対象のキャッシュディレクトリーパスです。
   */
  readonly #cacheDir: string;

  /**
   * ハンドルを初期化します。
   *
   * @param storage 親ストレージです。
   * @param mux 同期用ミューテックスです。
   * @param cacheDir キャッシュパスです。
   */
  public constructor(storage: NodeFsCacheStorage, mux: Asyncmux, cacheDir: string) {
    this.#storage = storage;
    this.#mux = mux;
    this.#cacheDir = cacheDir;
  }

  /**
   * ストレージがオープン状態であることを確認します。
   */
  #assertOk(): void {
    if (!this.#storage.isOpen) {
      const error = new Error("NodeFsCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * キャッシュデータを読み取るための非同期ジェネレーターを取得します。
   *
   * @param args 読み取りオプション（キャンセル信号など）です。
   * @returns チャンクを生成するジェネレーター、またはキャッシュが存在しない場合は null です。
   */
  public async getReader(args: GetReaderArgs): Promise<
    | AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown>
    | null
  > {
    const { fs, path } = modules;
    const { signal } = args;

    // 読み取り用の共有ロックを取得します。
    using _1 = await this.#mux.rLock({ signal });
    this.#assertOk();

    const metaPath = path.join(this.#cacheDir, "meta.json");
    let metaJson: string;

    try {
      // メタデータファイルを読み込み、キャッシュの整合性を確認します。
      metaJson = await fs.readFile(metaPath, { encoding: "utf-8", signal });
    } catch (ex) {
      // ファイルが存在しない場合はキャッシュ未作成と判断し、null を返します。
      if (typeof ex === "object" && ex && "code" in ex && ex.code === "ENOENT") {
        return null;
      }
      throw ex;
    }

    const meta: Metadata = JSON.parse(metaJson);
    const chunkCount = meta.chunkCount;
    const storage = this.#storage;
    const cacheDir = this.#cacheDir;

    /**
     * 各チャンクファイルを順番に読み込むジェネレーター関数です。
     */
    async function* createReader() {
      for (let index = 0; index < chunkCount; index++) {
        // 各ループでストレージの状態を再確認します。
        if (!storage.isOpen) {
          throw new Error("NodeFsCacheStorage is closed");
        }

        const chunkPath = path.join(cacheDir, `${index}.bin`);
        try {
          // チャンクファイルをバッファーとして読み込み、Uint8Array に変換して yield します。
          const chunkBuffer = await fs.readFile(chunkPath, { signal });
          const chunk = new Uint8Array(
            chunkBuffer.buffer,
            chunkBuffer.byteOffset,
            chunkBuffer.byteLength,
          );
          yield chunk;
        } catch (ex) {
          if (typeof ex === "object" && ex && "code" in ex && ex.code === "ENOENT") {
            throw new Error(`Missing chunk at index ${index}`);
          }
          throw ex;
        }
      }
    }

    return createReader();
  }

  /**
   * キャッシュデータを書き込むためのライターを取得します。
   *
   * @param args 書き込みオプションです。
   * @returns 書き込み用のライターインスタンスです。
   */
  public async getWriter(args: GetWriterArgs): Promise<IWriter> {
    const { fs } = modules;
    const { signal } = args;

    // 読み取り用ロックを取得（書き込み中でも構造的な競合を避けるため）します。
    using _1 = await this.#mux.rLock({ signal });
    this.#assertOk();

    // キャッシュを格納するためのディレクトリーを作成します。
    await fs.mkdir(this.#cacheDir, { recursive: true });

    return new NodeFsCacheWriter(this.#storage, this.#cacheDir);
  }
}

/**
 * Node.js のファイルシステムを基盤としたキャッシュストレージの実装です。
 */
export default class NodeFsCacheStorage implements ICacheStorage, AsyncDisposable {
  /**
   * ユーザーから渡されたベースディレクトリーの入力値です。
   */
  readonly #baseDirInput: string;

  /**
   * 解決された絶対パス形式のベースディレクトリーです。
   */
  #baseDir: string;

  /**
   * 全体的な排他制御を司るミューテックスです。
   */
  readonly #mux: Asyncmux;

  /**
   * ストレージが開いているかどうかを保持します。
   */
  #isOpen: boolean;

  /**
   * インスタンスを生成します。
   *
   * @param baseDir キャッシュを保存するベースディレクトリーです。デフォルトは ".dl-once" です。
   */
  public constructor(baseDir: string | undefined = ".dl-once") {
    this.#baseDirInput = baseDir;
    this.#baseDir = "";
    this.#mux = new Asyncmux();
    this.#isOpen = false;
  }

  /**
   * ストレージがオープンされていない場合にエラーを投げます。
   */
  #assertOk(): void {
    if (!this.isOpen) {
      const error = new Error("NodeFsCacheStorage is closed");
      tryCaptureStackTrace(error, this.#assertOk);
      throw error;
    }
  }

  /**
   * ストレージが現在利用可能（オープン状態）かどうかを取得します。
   */
  public get isOpen(): boolean {
    return this.#isOpen;
  }

  /**
   * ストレージを初期化し、利用可能な状態にします。
   *
   * 必要な Node.js モジュールのインポートとベースディレクトリーの作成を行います。
   *
   * @param options オープン時のオプション（タイムアウト用シグナルなど）です。
   * @returns 完了を示すプロミスです。
   */
  public async open(options: OpenOptions | undefined = {}): Promise<void> {
    const { signal } = options;

    // 書き込みロックを取得して排他的に初期化を行います。
    using _ = await this.#mux.lock({ signal });

    if (this.#isOpen) {
      throw new Error("Storage is already open");
    }

    // 実行時に Node.js 標準モジュールをインポートします。
    const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
    modules.fs = fs;
    modules.path = path;

    // ベースディレクトリーのパスを絶対パスとして確定させます。
    this.#baseDir = path.resolve(this.#baseDirInput);

    // ストレージのルートディレクトリーを作成します。
    await fs.mkdir(this.#baseDir, { recursive: true });

    this.#isOpen = true;
  }

  /**
   * ストレージを閉じ、以降の操作を無効化します。
   *
   * @param options クローズ時のオプションです。
   * @returns 完了を示すプロミスです。
   */
  public async close(options: CloseOptions | undefined = {}): Promise<void> {
    const { signal } = options;

    using _ = await this.#mux.lock({ signal });

    this.#assertOk();

    this.#isOpen = false;
  }

  /**
   * `using` 構文などで自動的にリソースを解放するためのメソッドです。
   *
   * @returns 完了を示すプロミスです。
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    using _ = await this.#mux.lock();

    this.#isOpen = false;
  }

  /**
   * 特定のキャッシュ、またはストレージ全体を削除します。
   *
   * @param cacheKey 削除対象の特定のキャッシュキーです。
   * @param options 削除オプションです。
   * @returns 完了を示すプロミスです。
   */
  public clear(
    cacheKey?: string | undefined,
    options?: Omit<ClearOptions, "cacheKey"> | undefined,
  ): Promise<void>;

  /**
   * オプション指定による削除を行います。
   *
   * @param options 削除オプションです。
   * @returns 完了を示すプロミスです。
   */
  public clear(options?: ClearOptions | undefined): Promise<void>;

  /**
   * キャッシュの削除処理を実際に実行します。
   *
   * @param cacheKeyOrOptions キー文字列またはオプションオブジェクトです。
   * @param options 追加のオプションです。
   */
  public async clear(
    cacheKeyOrOptions?: string | ClearOptions | undefined,
    options: Omit<ClearOptions, "cacheKey"> | undefined = {},
  ): Promise<void> {
    const { fs } = modules;

    // 引数の型に応じて正規化し、シグナルとキーを抽出します。
    const {
      signal,
      cacheKey,
    } = typeof cacheKeyOrOptions === "object"
      ? cacheKeyOrOptions
      : {
        ...options,
        cacheKey: cacheKeyOrOptions,
      };

    using _1 = await this.#mux.lock({ signal });

    this.#assertOk();

    if (cacheKey !== undefined) {
      // 特定のキャッシュディレクトリーのみを再帰的に削除します。
      const cacheDir = getCacheDir(this.#baseDir, cacheKey);
      await fs.rm(cacheDir, { recursive: true, force: true });
    } else {
      // ストレージ全体を削除し、空のベースディレクトリーを再作成します。
      await fs.rm(this.#baseDir, { recursive: true, force: true });
      await fs.mkdir(this.#baseDir, { recursive: true });
    }
  }

  /**
   * 指定されたキーに対応するキャッシュ操作ハンドルを作成します。
   *
   * @param key キャッシュを一意に識別するキーです。
   * @returns キャッシュハンドルインスタンスです。
   */
  public createCacheHandle(key: string): ICacheHandle {
    this.#assertOk();

    const cacheDir = getCacheDir(this.#baseDir, key);

    return new NodeFsCacheHandle(this, this.#mux, cacheDir);
  }
}
