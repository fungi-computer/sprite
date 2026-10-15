import { describe, expect, it, vi } from "vitest";
import { createAssetReader } from "./assets.js";

describe("avatar asset admission", () => {
  const policy = {
    baseURL: "https://art.example/characters/cat.sprite",
    allowedOrigins: ["https://art.example"],
    maxBytes: 12,
    maxTotalBytes: 18,
    maxRequests: 3,
  };

  it("resolves nested artwork against its document and rejects redirects", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("art"));
    const signal = new AbortController().signal;
    const asset = await createAssetReader({ ...policy, fetch })()(
      "atlas.png",
      signal,
    );
    expect(asset.url).toBe("https://art.example/characters/atlas.png");
    expect(fetch).toHaveBeenCalledWith(asset.url, {
      signal,
      redirect: "error",
    });
    expect(new TextDecoder().decode(asset.bytes)).toBe("art");
  });

  it("rejects unapproved origins and executable/data URL schemes before fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const read = createAssetReader({ ...policy, fetch })();
    for (const url of [
      "https://other.example/art",
      "data:text/plain,art",
      "javascript:alert(1)",
    ]) {
      await expect(read(url, new AbortController().signal)).rejects.toThrow(
        "not admitted",
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enforces actual bytes even without a content-length header", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("longer than twelve bytes"));
    await expect(
      createAssetReader({ ...policy, fetch })()(
        "art",
        new AbortController().signal,
      ),
    ).rejects.toThrow("byte limit");
  });

  it("preserves stream cancellation failures alongside the read failure", async () => {
    const cancellationError = new Error("stream cancellation failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("longer than twelve bytes"),
        );
      },
      cancel() {
        return Promise.reject(cancellationError);
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body));

    await expect(
      createAssetReader({ ...policy, fetch })()(
        "art",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: "Avatar asset exceeds the byte limit",
        }),
        cancellationError,
      ],
    });
  });

  it("bounds cumulative bytes and requests for one selection", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(new Response("1234567")));
    const read = createAssetReader({
      ...policy,
      maxTotalBytes: 12,
      maxRequests: 2,
      fetch,
    })();
    const signal = new AbortController().signal;
    await read("first", signal);
    await expect(read("second", signal)).rejects.toThrow("total byte limit");
    await expect(read("third", signal)).rejects.toThrow("request limit");
    expect(fetch).toHaveBeenCalledTimes(2);
    // A different selection gets a fresh, independent budget.
    await expect(
      createAssetReader({ ...policy, maxTotalBytes: 12, fetch })()(
        "fresh",
        signal,
      ),
    ).resolves.toMatchObject({ url: "https://art.example/characters/fresh" });
  });
});
