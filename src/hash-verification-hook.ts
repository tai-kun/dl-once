import type { IHasher } from "hash-wasm";
import type { ChunkReadHandlerArgs, IHook } from "./dl-once.js";

/**
 * ダウンロードされたデータのハッシュ値を検証するためのフッククラスです。
 *
 * `hash-wasm` ライブラリーを使用して、ストリーム読み込みに合わせて逐次的にハッシュ計算を行い、完了時に期待されるハッシュ値と一致するかを判定します。
 */
export default class HashVerificationHook implements IHook {
  /**
   * ハッシュ計算を行うオブジェクトを作成する関数です。
   */
  #createHahser: () => Promise<IHasher>;

  /**
   * ハッシュ計算を行うための WebAssembly インスタンスを保持するプロパティーです。
   */
  #hasher: IHasher | null = null;

  /**
   * 比較対象となる期待されるハッシュ値（小文字）を保持する読み取り専用プロパティーです。
   */
  readonly #expectedHash: string;

  /**
   * HashVerificationHook の新しいインスタンスを作成します。
   *
   * @param createHahser ハッシュ計算を行うオブジェクトを作成する関数です。
   * @param expectedHash 比較対象となる 16 進数形式の期待されるハッシュ値です。
   */
  public constructor(createHahser: () => Promise<IHasher>, expectedHash: string) {
    this.#createHahser = createHahser;
    // 比較時の揺らぎをなくすため、入力されたハッシュ値を小文字に正規化して保存します。
    this.#expectedHash = expectedHash.toLowerCase();
  }

  /**
   * ダウンロード開始前に呼び出される非同期メソッドです。
   *
   * ハッシュ計算用の WebAssembly インスタンスを作成し、初期化処理を行います。
   *
   * @returns インスタンスの準備が完了した際に解決される Promise です。
   */
  public async onBeforeDownload(): Promise<void> {
    if (this.#hasher) {
      throw new Error("Hasher is already initialized");
    }

    // hash-wasm ライブラリーを使用してハッシュ計算用の WASM インスタンスを作成します。
    this.#hasher = await this.#createHahser();

    // ハッシュ計算の内部状態をリセットし、新しいストリームの受け入れ準備を整えます。
    this.#hasher.init();
  }

  /**
   * データチャンクが読み込まれるたびに呼び出されるメソッドです。
   *
   * 取得したチャンクデータをハッシュ計算機に送り、中間状態を更新します。
   *
   * @param args チャンクデータを含むハンドラー引数です。
   */
  public onChunkRead(args: Pick<ChunkReadHandlerArgs, "chunkData">): void {
    const { chunkData } = args;

    // 初期化済みのハッシュ計算機へバイナリーデータを渡します。
    // update メソッドにより、メモリー効率を保ちながら逐次計算が行われます。
    this.#hasher!.update(chunkData);
  }

  /**
   * ダウンロードストリームが正常に終了した際に呼び出されるメソッドです。
   *
   * 最終的なハッシュ値を算出し、期待される値と異なる場合はエラーを投げます。
   */
  public onClose(): void {
    // これまでに蓄積されたデータから最終的なダイジェスト（16 進数文字列）を作成します。
    const finalHash = this.#hasher!.digest();

    // 算出したハッシュと、コンストラクターで受け取った期待値を比較します。
    if (finalHash !== this.#expectedHash) {
      // データの整合性が保たれていないため、詳細な情報を添えてエラーを投げます。
      throw new Error(`Hash mismatch! Expected: ${this.#expectedHash}, but got: ${finalHash}`);
    }

    this.#hasher = null;
  }

  /**
   * ダウンロード中にエラーが発生した際に呼び出されるメソッドです。
   *
   * 保持しているハッシュ計算機のインスタンスを破棄し、リソースを解放します。
   */
  public onError(): void {
    // 計算途中の状態を破棄するため、プロパティーを null にリセットします。
    this.#hasher = null;
  }
}
