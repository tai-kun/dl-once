import { describe, test as vitest } from "vitest";
import type { ICacheStorage } from "../src/cache-storage.js";
import IndexedDbCacheStorage from "../src/indexeddb-cache-storage.js";
import MemoryCacheStorage from "../src/memory-cache-storage.js";
import NodeFsCacheStorage from "../src/node-fs-cache-storage.js";

const TARGET_KEY = "test-cache-key";

type Fixture = (use: (value: ICacheStorage) => Promise<void>) => Promise<void>;

let fixture: Fixture;

const test = vitest.extend<{
  storage: ICacheStorage;
}>({
  async storage({}, use) {
    await fixture(use);
  },
});

for (
  const [name, info] of Object.entries<{
    skip: boolean;
    fixture: (use: (value: ICacheStorage) => Promise<void>) => Promise<void>;
  }>({
    MemoryCacheStorage: {
      skip: false,
      async fixture(use) {
        const storage: ICacheStorage = new MemoryCacheStorage();

        await use(storage);

        if (!storage.isOpen) {
          await storage.open();
        }

        await storage.clear();
        await storage.close();
      },
    },
    IndexedDbCacheStorage: {
      skip: typeof document === "undefined",
      async fixture(use) {
        const storage: ICacheStorage = new IndexedDbCacheStorage("test");

        await use(storage);

        if (!storage.isOpen) {
          await storage.open();
        }

        await storage.clear();
        await storage.close();
      },
    },
    NodeFsCacheStorage: {
      skip: typeof document !== "undefined",
      async fixture(use) {
        const storage: ICacheStorage = new NodeFsCacheStorage("tests/.dl-once");

        await use(storage);

        if (!storage.isOpen) {
          await storage.open();
        }

        await storage.clear();
        await storage.close();
      },
    },
  })
) {
  if (info.skip) {
    continue;
  }

  fixture = info.fixture;

  describe(name, { skip: info.skip }, () => {
    describe("ストレージの基本管理", () => {
      test("初期状態ではストレージは閉じている", ({ expect, storage }) => {
        // Assert
        expect(storage.isOpen).toBe(false);
      });

      test("ストレージをオープンすると、isOpen が真になる", async ({ expect, storage }) => {
        // Act
        await storage.open();

        // Assert
        expect(storage.isOpen).toBe(true);
      });

      test("オープン済みのストレージをクローズすると、isOpen が偽になる", async ({ expect, storage }) => {
        // Arrange
        await storage.open();

        // Act
        await storage.close();

        // Assert
        expect(storage.isOpen).toBe(false);
      });

      test("クローズ状態のストレージを再度クローズしてエラー", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        await storage.close();

        // Act & Assert
        await expect(async () => await storage.close()).rejects.toThrow();
        expect(storage.isOpen).toBe(false);
      });

      test("中断されたシグナルを渡してオープンを試みると、AbortError を投げてストレージは開かれない", async ({ expect, storage }) => {
        // Arrange
        const controller = new AbortController();
        controller.abort();

        // Act & Assert
        await expect(async () => await storage.open({ signal: controller.signal }))
          .rejects
          .toThrow();
        expect(storage.isOpen).toBe(false);
      });
    });

    describe("キャッシュデータの操作", () => {
      test("指定したキーでキャッシュハンドルを作成できる", async ({ expect, storage }) => {
        // Act
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);

        // Assert
        expect(handle).toBeDefined();
        // 実装詳細ではなく、振る舞いとして getWriter が呼べることを確認
        expect(typeof handle.getWriter).toBe("function");
      });

      test("データが存在しない場合、リーダーの取得結果は null になる", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();

        // Act
        const reader = await handle.getReader({ signal: controller.signal });

        // Assert
        expect(reader).toBeNull();
      });

      test("ライターを使用してデータを書き込んだ後、同じキーからデータを読み出すことができる", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();
        const request = new Request("https://example.com");
        const response = new Response("test-data");
        const testData = new TextEncoder().encode("hello world");
        const writer = await handle.getWriter({ request, response, signal: controller.signal });
        await writer.write(testData);
        await writer.close();

        // Act
        const reader = await handle.getReader({ signal: controller.signal });

        // Assert
        expect(reader).not.toBeNull();
        const chunks: Uint8Array[] = [];
        for await (const chunk of reader!) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBe(1);
        expect(chunks[0]).toEqual(testData);
      });

      test("clear を実行すると、保存されていたデータが削除され、リーダーが null を返すようになる", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();
        const writer = await handle.getWriter({
          request: new Request("https://example.com"),
          response: new Response("data"),
          signal: controller.signal,
        });
        await writer.write(new Uint8Array([1]));
        await writer.close();

        // Act
        await storage.clear(TARGET_KEY);

        // Assert
        const reader = await handle.getReader({ signal: controller.signal });
        expect(reader).toBeNull();
      });

      test("特定のキーを指定して clear をしたとき、他のキーのデータは維持される", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const key1 = "key-1";
        const key2 = "key-2";
        const controller = new AbortController();
        const data = new Uint8Array([1]);
        const writeData = async (key: string) => {
          const h = storage.createCacheHandle(key);
          const w = await h.getWriter({
            request: new Request("https://example.com"),
            response: new Response("d"),
            signal: controller.signal,
          });
          await w.write(data);
          await w.close();
        };
        await writeData(key1);
        await writeData(key2);

        // Act
        await storage.clear(key1);

        // Assert
        const reader1 = await storage.createCacheHandle(key1).getReader({
          signal: controller.signal,
        });
        const reader2 = await storage.createCacheHandle(key2).getReader({
          signal: controller.signal,
        });

        expect(reader1).toBeNull();
        expect(reader2).not.toBeNull();
      });
    });

    describe("異常系・境界値の振る舞い", () => {
      test("ストレージが未オープンの状態でライターを取得しようとすると、エラーが発生する", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        await storage.close();
        const controller = new AbortController();

        // Act & Assert
        await expect(async () => {
          await handle.getWriter({
            request: new Request("https://example.com"),
            response: new Response(""),
            signal: controller.signal,
          });
        })
          .rejects
          .toThrow();
      });

      test("ライターを取得した後に中断シグナルを発火させても、ライターには影響しない", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();
        const writer = await handle.getWriter({
          request: new Request("https://example.com"),
          response: new Response(""),
          signal: controller.signal,
        });

        // Act
        controller.abort("manual abort");

        // Assert
        await expect((async () => await writer.write(new Uint8Array([1])))())
          .resolves
          .not
          .toThrow();
      });

      test("ライターで abort を呼び出すと、書き込みが中断されリソースが閉じられる", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();
        const writer = await handle.getWriter({
          request: new Request("https://example.com"),
          response: new Response(""),
          signal: controller.signal,
        });

        // Act
        await writer.abort("test reason");

        // Assert
        await expect(async () => await writer.write(new Uint8Array([1]))).rejects.toThrow();
        const reader = await handle.getReader({ signal: controller.signal });
        expect(reader).toBeNull();
      });

      test("空のデータ（長さ 0 の Uint8Array）を書き込んでもエラーにならない", async ({ expect, storage }) => {
        // Arrange
        await storage.open();
        const handle = storage.createCacheHandle(TARGET_KEY);
        const controller = new AbortController();
        const writer = await handle.getWriter({
          request: new Request("https://example.com"),
          response: new Response(""),
          signal: controller.signal,
        });

        // Act & Assert
        await expect((async () => await writer.write(new Uint8Array(0)))())
          .resolves
          .not
          .toThrow();
        await writer.close();
      });
    });
  });
}
