/**
 * `Uint8Array` のチャンクを効率的に積み上げ、最終的に一つのバイナリーデータとして結合するためのビルダー形式のクラスです。
 */
export default class BytesBuilder {
  /**
   * 書き込まれたバイナリーデータのチャンクを保持する配列です。
   * @private
   */
  private chunks: Uint8Array<ArrayBuffer>[];

  /**
   * 現在までに書き込まれた全データの合計バイト長です。
   * @private
   */
  private length: number;

  /**
   * `BytesBuilder` クラスの新しいインスタンスを初期化します。
   */
  public constructor() {
    // 内部状態を初期化します。
    this.chunks = [];
    this.length = 0;
  }

  /**
   * 新しいバイナリーデータをチャンクとして追加します。
   *
   * @param data 追加する `Uint8Array` 形式のデータです。
   */
  public write(data: Uint8Array<ArrayBuffer>): void {
    // チャンク配列にデータを追加し、全体の長さを更新します。
    this.chunks.push(data);
    this.length += data.length;
  }

  /**
   * 現在保持しているすべてのチャンクを結合して、一つの `Uint8Array` として返します。
   *
   * このメソッドを呼び出すと、内部のチャンクと長さの情報はリセットされます。
   *
   * @returns 結合されたすべてのデータを含む `Uint8Array` です。
   */
  public bytes(): Uint8Array<ArrayBuffer> {
    // 全体の長さに合わせた新しいバッファーを確保します。
    const bytes = new Uint8Array(this.length);

    // 書き込み位置を管理するためのオフセット変数です。
    let offset = 0;

    // 保持している各チャンクを、作成したバッファーの適切な位置にコピーしていきます。
    for (const data of this.chunks) {
      // 指定したオフセットからデータをセットします。
      bytes.set(data, offset);
      // 次のチャンクのためにオフセットを更新します。
      offset += data.length;
    }

    // 次回の書き込みに備えて、内部の状態（チャンク配列と合計長）をリセットします。
    this.chunks = [];
    this.length = 0;

    // 結合済みのバイナリーデータを返します。
    return bytes;
  }
}
