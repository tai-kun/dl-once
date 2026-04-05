import { describe, test, vi } from "vitest";
import downloadOnce, { type IReader, type IWriter } from "../src/dl-once.js";

function createReader(chunks: readonly Uint8Array<ArrayBuffer>[]): IReader {
  return (function*() {
    yield* chunks;
  })();
}

function createWriter() {
  return {
    write: vi.fn(),
    close: vi.fn(),
    abort: vi.fn(),
  } satisfies IWriter;
}

function createResponse(
  body: Uint8Array<ArrayBuffer>,
  status = 200,
  statusText = "OK",
): Response {
  return new Response(body, {
    status,
    statusText,
  });
}

describe("正常系", () => {
  test("単一のターゲットからデータを取得したとき、正しい Uint8Array を返す", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);

    // Act
    const result = await downloadOnce({
      target: downloadUrl,
      fetcher,
    });

    // Assert
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(3);
    expect(result).toStrictEqual(dummyData);
  });

  test("キャッシュが有効でデータが存在する場合、ネットワーク通信を行わずキャッシュデータを返す", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const cacheData = new Uint8Array([9, 9, 9]);
    const fetcher = vi.fn();
    const cacheHandle = {
      getReader: vi.fn().mockReturnValue(createReader([cacheData])),
      getWriter: createWriter,
    };

    // Act
    const result = await downloadOnce({
      target: downloadUrl,
      fetcher,
      cacheHandle,
    });

    // Assert
    expect(result).toStrictEqual(cacheData);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("最初のターゲットが失敗しても、次のターゲットが有効であれば成功する", async ({ expect }) => {
    // Arrange
    const falirelUrl = "https://example.com/falire";
    const successUrl = "https://example.com/success";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("[TEST]: Network Error")) // falirelUrl
      .mockResolvedValueOnce(response); // successUrl

    // Act
    const result = await downloadOnce([falirelUrl, successUrl], { fetcher });

    // Assert
    expect(result).toStrictEqual(dummyData);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("ダウンロードの各フェーズでフックが正しい順序と引数で呼び出される", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);
    const onBeforeDownload = vi.fn();
    const onChunkRead = vi.fn();
    const onClose = vi.fn();

    // Act
    await downloadOnce({
      target: downloadUrl,
      fetcher,
      hooks: [{
        onBeforeDownload,
        onChunkRead,
        onClose,
      }],
    });

    // Assert
    expect(onBeforeDownload).toHaveBeenCalled();
    expect(onChunkRead).toHaveBeenCalledWith(expect.objectContaining({
      chunkData: dummyData,
    }));
    expect(onClose).toHaveBeenCalled();
    // 呼び出し順序の検証
    const beforeDownloadOrder = onBeforeDownload.mock.invocationCallOrder[0]!;
    const chunkReadOrder = onChunkRead.mock.invocationCallOrder[0]!;
    const closeOrder = onClose.mock.invocationCallOrder[0]!;
    expect(beforeDownloadOrder).lessThan(chunkReadOrder);
    expect(chunkReadOrder).lessThan(closeOrder);
  });
});

describe("異常系・エラーハンドリング", () => {
  test("すべてのターゲットが失敗したとき、AggregateError を投げる", async ({ expect }) => {
    // Act & Assert
    await expect(downloadOnce(["url1", "url2"]))
      .rejects
      .toThrow(AggregateError);
  });

  test("ターゲット配列が空の場合、適切なエラーメッセージと共にエラーを投げる", async ({ expect }) => {
    // Act & Assert
    await expect(downloadOnce([]))
      .rejects
      .toThrow("No targets provided");
  });

  test("HTTP ステータスが 404 の場合、エラーとして扱い次のターゲットへ移行するか失敗する", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const response = createResponse(new Uint8Array(), 404, "Not Found");
    const fetcher = vi.fn().mockResolvedValue(response);

    // Act & Assert
    await expect(downloadOnce(downloadUrl, { fetcher }))
      .rejects
      .toThrow("HTTP Error: [404] Not Found");
  });

  test("キャッシュ読み込み中に例外が発生しても、ネットワークフェッチにフォールバックして成功する", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);
    const cacheHandle = {
      getReader: vi.fn().mockThrow(new Error("[TEST]: Cache Corrupted")),
      getWriter: createWriter,
    };

    // Act
    const result = await downloadOnce({
      target: downloadUrl,
      fetcher,
      cacheHandle,
    });

    // Assert
    expect(result).toStrictEqual(dummyData);
    expect(fetcher).toHaveBeenCalled();
  });

  test("チャンク読み込み中にエラーが発生しても、そのフックは無視され全体の処理は継続される", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);
    const onError = vi.fn();
    const faultyHook = {
      onChunkRead: vi.fn().mockThrow(new Error("[TEST]: Hook Error")),
      onError,
    };

    // Act
    const result = await downloadOnce({ target: downloadUrl, fetcher, hooks: [faultyHook] });

    // Assert
    expect(result).toStrictEqual(dummyData);
    expect(onError).toHaveBeenCalled();
  });

  test("完了フック内でエラーが発生したら、ダウンロードエラーとして扱われる", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);
    const onError = vi.fn();
    const faultyHook = {
      onClose: vi.fn().mockThrow(new Error("[TEST]: Hook Error")),
      onError,
    };

    // Act & Assert
    await expect(downloadOnce(downloadUrl, { fetcher, hooks: [faultyHook] }))
      .rejects
      .toThrow("[TEST]: Hook Error");
    expect(onError).toHaveBeenCalled();
  });
});

describe("中断・タイムアウト", () => {
  test("既に中断されているシグナルを渡したとき、通信を行わず AbortError を投げる", async ({ expect }) => {
    // Arrange
    const abortError = new Error("[TEST] Abort");
    const controller = new AbortController();
    controller.abort(abortError);
    const downloadUrl = "https://example.com/data";
    const fetcher = vi.fn();

    // Act & Assert
    await expect(downloadOnce({ target: downloadUrl, fetcher }, { signal: controller.signal }))
      .rejects
      .toThrow(abortError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("ダウンロード中に中断が実行されたとき、リソースを解放して AbortError を投げる", async ({ expect }) => {
    // Arrange
    const abortError = new Error("[TEST] Abort");
    const controller = new AbortController();
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          async read() {
            controller.abort(abortError); // 読み取り中に中断
            return {
              done: false,
              value: dummyData,
            };
          },
          cancel,
          releaseLock,
        }),
      },
    });

    // Act & Assert
    await expect(downloadOnce({ target: downloadUrl, fetcher }, { signal: controller.signal }))
      .rejects
      .toThrow(abortError);
    expect(cancel).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
  });
});

describe("境界値・特殊ケース", () => {
  test("レスポンスボディが空のとき、長さ 0 の Uint8Array を返す", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const response = createResponse(new Uint8Array());
    const fetcher = vi.fn().mockResolvedValue(response);

    // Act
    const result = await downloadOnce({ target: downloadUrl, fetcher });

    // Assert
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  test("フックに無効な値が含まれていても、エラーなく無視して実行される", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);

    // Act
    const result = await downloadOnce({
      target: downloadUrl,
      fetcher,
      hooks: [null, undefined, false],
    });

    // Assert
    expect(result).toStrictEqual(dummyData);
  });

  test("ターゲットが動的な関数であるとき、関数を実行して解決された URL から取得する", async ({ expect }) => {
    // Arrange
    const downloadUrl = "https://example.com/data";
    const dynamicTarget = async () => downloadUrl;
    const dummyData = new Uint8Array([1, 2, 3]);
    const response = createResponse(dummyData);
    const fetcher = vi.fn().mockResolvedValue(response);

    // Act
    const result = await downloadOnce({ target: dynamicTarget, fetcher });

    // Assert
    expect(result).toStrictEqual(dummyData);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ url: downloadUrl }),
      expect.toBeOneOf([undefined]),
    );
  });
});
