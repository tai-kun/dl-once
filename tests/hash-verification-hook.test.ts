import type { IHasher } from "hash-wasm";
import { test, vi } from "vitest";
import HashVerificationHook from "../src/hash-verification-hook.js";

function createMockHasher(digestValue: string = "actual_hash") {
  return {
    init: vi.fn(),
    update: vi.fn(),
    digest: vi.fn().mockReturnValue(digestValue),
  };
}

test("ダウンロード開始前にハッシュ計算機が初期化されるとき、hasher の init メソッドが 1 回呼び出される", async ({ expect }) => {
  // Arrange
  const mockHasher = createMockHasher();
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "expected_hash",
  );

  // Act
  await hook.onBeforeDownload();

  // Assert
  expect(mockHasher.init).toHaveBeenCalledTimes(1);
});

test("チャンクデータが読み込まれたとき、そのデータがハッシュ計算機の update メソッドに渡される", async ({ expect }) => {
  // Arrange
  const mockHasher = createMockHasher();
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "expected_hash",
  );
  const chunk = new Uint8Array([1, 2, 3]);
  await hook.onBeforeDownload();

  // Act
  hook.onChunkRead({ chunkData: chunk });

  // Assert
  expect(mockHasher.update).toHaveBeenCalledWith(chunk);
});

test("算出されたハッシュ値が期待値と一致するとき、onClose は例外を投げずに正常終了する", async ({ expect }) => {
  // Arrange
  const hashValue = "match_hash";
  const mockHasher = createMockHasher(hashValue);
  // コンストラクタに渡す期待値（大文字が含まれていても正規化されることを検証に含める）
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "MATCH_HASH",
  );
  await hook.onBeforeDownload();
  hook.onChunkRead({ chunkData: new Uint8Array([0]) });

  // Act & Assert
  expect(() => {
    hook.onClose();
  })
    .not
    .toThrow();
});

test("算出されたハッシュ値が期待値と不一致のとき、onClose は Hash mismatch エラーをスローする", async ({ expect }) => {
  // Arrange
  const mockHasher = createMockHasher("actual_hash");
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "expected_hash",
  );
  await hook.onBeforeDownload();
  hook.onChunkRead({ chunkData: new Uint8Array([0]) });

  // Act & Assert
  expect(() => {
    hook.onClose();
  })
    .toThrow(/Hash mismatch!/);
});

test("複数のチャンクが逐次的に読み込まれるとき、すべてのチャンクが順番にハッシュ計算機に供給される", async ({ expect }) => {
  // Arrange
  const mockHasher = createMockHasher();
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "any",
  );
  const chunks = [
    new Uint8Array([10]),
    new Uint8Array([20]),
    new Uint8Array([30]),
  ];
  await hook.onBeforeDownload();

  // Act
  for (const chunk of chunks) {
    hook.onChunkRead({ chunkData: chunk });
  }

  // Assert
  expect(mockHasher.update).toHaveBeenCalledTimes(3);
  expect(mockHasher.update).toHaveBeenNthCalledWith(1, chunks[0]);
  expect(mockHasher.update).toHaveBeenNthCalledWith(2, chunks[1]);
  expect(mockHasher.update).toHaveBeenNthCalledWith(3, chunks[2]);
});

test("空のデータが読み込まれたとき、初期状態のハッシュ値との比較が行われる", async ({ expect }) => {
  // Arrange
  // 空データの SHA-256 仮定（実際の実装に依存するが、ここでは不一致でエラーになる振る舞いを確認）
  const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const mockHasher = createMockHasher(emptyHash);
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    emptyHash,
  );
  await hook.onBeforeDownload();

  // Act & Assert
  // update を一度も呼ばずにクローズ
  expect(() => {
    hook.onClose();
  })
    .not
    .toThrow();
});

test("エラーが発生して onError が呼ばれたとき、それ以降の操作でハッシュ計算機が利用されない", async ({ expect }) => {
  // Arrange
  const mockHasher = createMockHasher();
  const hook = new HashVerificationHook(
    () => Promise.resolve(mockHasher as unknown as IHasher),
    "any",
  );
  await hook.onBeforeDownload();

  // Act
  hook.onError();

  // Assert
  // 内部リソースが解放されているため、以降の呼び出しで例外が発生することを確認する（実装の Null Safety 仕様に基づく）
  expect(() => {
    hook.onChunkRead({ chunkData: new Uint8Array([0]) });
  })
    .toThrow();
});

test("ハッシュの計算が終わらないうちに再度フックインスタンスを使いまわすとエラー", async ({ expect }) => {
  // Arrange
  const hook = new HashVerificationHook(
    () => Promise.resolve(createMockHasher() as unknown as IHasher),
    "any",
  );

  // Act
  await hook.onBeforeDownload();

  // Assert
  await expect(async () => {
    await hook.onBeforeDownload();
  })
    .rejects
    .toThrow();
});
