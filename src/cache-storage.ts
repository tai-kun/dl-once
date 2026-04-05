import type { ICacheHandle, MaybePromise } from "./dl-once.js";

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
