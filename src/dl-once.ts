import { getLogger } from "@logtape/logtape";
import BytesBuilder from "./_bytes-builder.js";

/**
 * ロガーのインスタンスです。
 */
const log = getLogger("dl-once");

/**
 * 同期的な値、または Promise ライクな値を表す型です。
 *
 * @template T 解決される値の型です。
 */
export type MaybePromise<T> = T | PromiseLike<T>;

/**
 * ダウンロード開始前に実行されるハンドラーに渡される引数の型定義です。
 */
export type BeforeDownloadHandlerArgs = {
  /**
   * 実行されるリクエストオブジェクトです。
   */
  request: Request;

  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * データのチャンクが読み込まれた際に実行されるハンドラーに渡される引数の型定義です。
 */
export type ChunkReadHandlerArgs = {
  /**
   * 読み込まれたバイナリーデータです。
   */
  chunkData: Uint8Array<ArrayBuffer>;

  /**
   * サーバーからのレスポンスオブジェクトです。
   */
  response: Response;

  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * 処理が正常に終了した際に実行されるハンドラーに渡される引数の型定義です。
 */
export type CloseHandlerArgs = {
  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * エラーが発生した際に実行されるハンドラーに渡される引数の型定義です。
 */
export type ErrorHandlerArgs = {
  /**
   * エラーの原因となったオブジェクトです。
   */
  reason: unknown;

  /**
   * 中断を監視するためのシグナルです。
   */
  signal: AbortSignal;
};

/**
 * ダウンロードの各フェーズで実行されるフック関数のインターフェースです。
 */
export interface IHook {
  /**
   * ダウンロード開始前に呼び出されます。
   */
  onBeforeDownload?(args: BeforeDownloadHandlerArgs): MaybePromise<void>;

  /**
   * チャンクデータが読み込まれるたびに呼び出されます。
   */
  onChunkRead?(args: ChunkReadHandlerArgs): MaybePromise<void>;

  /**
   * 正常終了時に呼び出されます。
   */
  onClose?(args: CloseHandlerArgs): MaybePromise<void>;

  /**
   * エラー発生時に呼び出されます。
   */
  onError?(args: ErrorHandlerArgs): MaybePromise<void>;
}

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
 * フェッチャーに渡される初期化オプションの型定義です。
 */
export type FetcherRequestInit = {
  /**
   * 中断を監視するためのシグナルです。
   */
  readonly signal: AbortSignal;
};

/**
 * カスタムの HTTP リクエスト実行関数の型定義です。
 */
export interface IFetcher {
  /**
   * HTTP リクエストを実行し、レスポンスを返します。
   *
   * @param request リクエストオブジェクトです。
   * @param init 初期化オプションです。
   * @returns レスポンスまたはそれを解決する Promise です。
   */
  (request: Request, init: FetcherRequestInit | undefined): MaybePromise<Response>;
}

/**
 * 単一のリクエストターゲットを表すプリミティブな型です。
 */
export type PrimitiveTarget = string | URL | Request;

/**
 * 動的にリクエストターゲットを生成するファクトリー関数の型定義です。
 */
export interface ITargetFactory {
  (): MaybePromise<PrimitiveTarget>;
}

/**
 * 解決可能なターゲットの型定義です。
 */
export type Target = PrimitiveTarget | ITargetFactory;

/**
 * JavaScript における Falsy な値の型定義です。
 */
export type Falsy = 0 | "" | false | null | undefined;

/**
 * 個別のダウンロード設定を定義する型です。
 */
export type Config = {
  /**
   * ダウンロード対象のターゲットです。
   */
  readonly target: Target;

  /**
   * 使用するキャッシュハンドルです。
   */
  readonly cacheHandle?: ICacheHandle | undefined;

  /**
   * キャッシュを無視して強制的にダウンロードするかどうかのフラグです。
   */
  readonly forceDownload?: boolean | undefined;

  /**
   * 適用されるフックのリストです。
   */
  readonly hooks?: readonly (IHook | Falsy)[] | undefined;

  /**
   * 使用するカスタムフェッチャーです。
   */
  readonly fetcher?: IFetcher | undefined;
};

/**
 * 全体的なダウンロード動作を制御するオプションの型定義です。
 */
export type Options = {
  /**
   * デフォルトで使用するキャッシュハンドルです。
   */
  readonly cacheHandle?: ICacheHandle | undefined;

  /**
   * デフォルトでキャッシュを無視するかどうかのフラグです。
   */
  readonly forceDownload?: boolean | undefined;

  /**
   * グローバルに適用されるフックのリストです。
   */
  readonly hooks?: readonly (IHook | Falsy)[] | undefined;

  /**
   * デフォルトで使用するフェッチャーです。
   */
  readonly fetcher?: IFetcher | undefined;

  /**
   * 処理全体の中断を管理するシグナルです。
   */
  readonly signal?: AbortSignal | undefined;
};

/**
 * ターゲット情報を解析して Request オブジェクトに変換します。
 *
 * @param target 解析対象のターゲットです。
 * @returns 解析された Request オブジェクトを返す Promise です。
 */
async function parseTarget(target: Target): Promise<Request> {
  return typeof target === "function"
    ? await parseTarget(await target())
    : target instanceof Request
    ? target
    : new Request(target);
}

/**
 * 指定されたターゲットからデータを一度だけダウンロードし、バイナリーデータとして返します。
 *
 * キャッシュが利用可能な場合はキャッシュから取得を試み、失敗した場合はネットワーク経由で取得します。
 *
 * @param target ダウンロード対象（単体、設定オブジェクト、またはその配列）です。
 * @param options ダウンロードの動作を制御するオプションです。
 * @returns 取得されたバイナリーデータ（Uint8Array）を解決する Promise です。
 */
export default async function downloadOnce(
  target: Target | Config | readonly (Target | Config)[],
  options: Options | undefined = {},
): Promise<Uint8Array<ArrayBuffer>> {
  // ターゲットを配列に正規化します。
  const targets = Array.isArray(target)
    ? target
    : [target];
  if (targets.length === 0) {
    throw new Error("No targets provided");
  }

  // オプションから各設定を抽出します。
  const {
    hooks: rawGlobalHooks = [],
    signal,
    fetcher: defaultFetcher = fetch,
    cacheHandle: defaultCacheHandle,
    forceDownload: defaultForceDownload = false,
  } = options;

  // Falsy な値を除去したグローバルフックのリストを作成します。
  const globalHooks = rawGlobalHooks.filter(hook => !!hook);

  // コールバック（フック等）で使用するタイムアウト付きのシグナルを設定します（デフォルトは 60 分）。
  const callbackSignal = signal || AbortSignal.timeout(60 * 60e3);

  const errors: unknown[] = [];

  // 複数のターゲットを順番に試行します。
  for (const item of targets) {
    // 各ループの開始時に中断を確認します。
    signal?.throwIfAborted();

    // ターゲットが Config オブジェクトか、プリミティブな Target かを判定して正規化します。
    const {
      hooks: targetHooks = [],
      target: actualTarget,
      fetcher = defaultFetcher,
      cacheHandle = defaultCacheHandle,
      forceDownload = defaultForceDownload,
    } = typeof item === "string"
        || item instanceof URL
        || item instanceof Request
        || typeof item === "function"
      ? { target: item }
      : item;

    let writer: IWriter | null = null;
    const hooks: IHook[] = [];
    const closedHooks = new Set<number>();

    try {
      // キャッシュからの読み込みを試行します。
      if (cacheHandle && !forceDownload) {
        try {
          const reader = await cacheHandle.getReader({
            signal: callbackSignal,
          });
          if (reader) {
            const chunks = new BytesBuilder();
            for await (const data of reader) {
              signal?.throwIfAborted();
              chunks.write(data);
            }

            return chunks.bytes();
          }
        } catch (ex) {
          // キャッシュ読み込み失敗時はログを出力し、ネットワークフェッチへフォールバックします。
          log.warn`Cache read failed, falling back to network fetch: ${ex}`;
        }
      }

      // ネットワークからのダウンロード準備を開始します。
      const request = await parseTarget(actualTarget);

      // 前処理フックを実行します（個別設定のフックを優先）。
      for (const hook of [...targetHooks.filter(hook => !!hook), ...globalHooks]) {
        await hook.onBeforeDownload?.({
          signal: callbackSignal,
          request,
        });
        hooks.push(hook);
      }

      // リクエスト初期化設定を作成します。
      const requestInit = signal instanceof AbortSignal
        ? { signal }
        : undefined;

      // HTTP リクエストを実行します。
      const response = await fetcher(request, requestInit);
      if (!response.ok) {
        throw new Error(`HTTP Error: [${response.status}] ${response.statusText}`);
      }
      if (!response.body) {
        throw new Error("Response body is null");
      }

      // キャッシュへの書き込みが可能な場合はライターを初期化します。
      if (cacheHandle) {
        try {
          writer = await cacheHandle.getWriter({
            signal: callbackSignal,
            request,
            response,
          });
        } catch (ex) {
          log.warn`Failed to create cache writer: ${ex}`;
        }
      }

      // ストリームからデータを読み取ります。
      const reader = response.body.getReader();
      const chunks = new BytesBuilder();
      try {
        while (true) {
          signal?.throwIfAborted();

          const {
            done,
            value: chunkData,
          } = await reader.read();

          if (chunkData) {
            // データを受信するたびに各フックの onChunkRead を呼び出します。
            for (let i = 0; i < hooks.length; i++) {
              if (closedHooks.has(i)) {
                continue;
              }

              const hook = hooks[i]!;
              try {
                await hook.onChunkRead?.({
                  signal: callbackSignal,
                  response,
                  chunkData,
                });
              } catch (ex) {
                // フック内でのエラー発生時は onError を呼び出し、そのフックをクローズ扱い（以降無視）にします。
                try {
                  closedHooks.add(i);
                  await hook.onError?.({
                    reason: ex,
                    signal: callbackSignal,
                  });
                } catch (ex) {
                  log.warn`Failed to call error handler: ${ex}`;
                }
              }
            }

            // 読み込んだデータをビルダーとキャッシュライターに書き込みます。
            chunks.write(chunkData);
            await writer?.write(chunkData);
          }

          if (done) {
            break;
          }
        }
      } catch (ex) {
        // リーダーの読み取り中にエラーが発生した場合はストリームをキャンセルします。
        try {
          await reader.cancel(ex);
        } catch (ex) {
          log.warn`Failed to cancel reader: ${ex}`;
        }

        throw ex;
      } finally {
        // ロックを確実に解放します。
        try {
          reader.releaseLock();
        } catch (ex) {
          log.warn`Failed to release reader lock: ${ex}`;
        }
      }

      // 正常終了時のクリーンアップ処理です。
      for (let i = 0; i < hooks.length; i++) {
        if (closedHooks.has(i)) {
          continue;
        }

        const hook = hooks[i]!;
        try {
          closedHooks.add(i);
          await hook.onClose?.({
            signal: callbackSignal,
          });
        } catch (ex) {
          try {
            await hook.onError?.({
              reason: ex,
              signal: callbackSignal,
            });
          } catch (ex) {
            log.warn`Failed to call error handler: ${ex}`;
          }

          throw ex;
        }
      }

      // キャッシュライターを閉じます。
      await writer?.close();
      writer = null;

      // すべてのデータを結合したバイナリーを返します。
      return chunks.bytes();
    } catch (ex) {
      // 試行が失敗した場合はエラーを蓄積し、次のターゲット（存在すれば）に移行します。
      errors.push(ex);

      // キャッシュ書き込みを中止します。
      try {
        await writer?.abort(ex);
        writer = null;
      } catch (ex) {
        log.warn`Failed to abort cache writer: ${ex}`;
      }

      // まだ生存しているフックに対してエラー通知を行います。
      for (let i = 0; i < hooks.length; i++) {
        if (closedHooks.has(i)) {
          continue;
        }

        const hook = hooks[i]!;
        try {
          closedHooks.add(i);
          await hook.onError?.({
            reason: ex,
            signal: callbackSignal,
          });
        } catch (ex) {
          log.warn`Failed to call error handler: ${ex}`;
        }
      }
    }
  }

  // すべてのターゲットで失敗した場合は AggregateError を投げます。
  if (errors.length === 1) {
    throw errors[0];
  } else {
    throw new AggregateError(errors);
  }
}
