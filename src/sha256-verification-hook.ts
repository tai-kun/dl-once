import { createSHA256 } from "hash-wasm";
import HashVerificationHook from "./hash-verification-hook.js";

/**
 * ダウンロードされたデータの SHA-256 ハッシュ値を検証するためのフッククラスです。
 *
 * `hash-wasm` ライブラリーを使用して、ストリーム読み込みに合わせて逐次的にハッシュ計算を行い、完了時に期待されるハッシュ値と一致するかを判定します。
 */
export default class Sha256VerificationHook extends HashVerificationHook {
  /**
   * Sha256VerificationHook の新しいインスタンスを生成します。
   *
   * @param expectedHash 比較対象となる 16 進数形式の期待されるハッシュ値です。
   */
  public constructor(expectedHash: string) {
    super(createSHA256, expectedHash);
  }
}
