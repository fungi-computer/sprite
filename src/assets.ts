/** Host-owned admission and resource limits for published avatar artwork. */
export type AssetPolicy = {
  readonly baseURL: string;
  readonly allowedOrigins: readonly string[];
  /** Maximum bytes admitted for one response. */
  readonly maxBytes: number;
  /** Cumulative bytes admitted across one character selection. */
  readonly maxTotalBytes: number;
  /** Number of requests admitted for one character selection. */
  readonly maxRequests: number;
  readonly fetch?: typeof fetch;
};

/** Decoded transport bytes; adapters use these instead of opening their own URLs. */
export type Asset = {
  readonly url: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
};

/** One policy-enforced path for documents and their nested native resources. */
export function createAssetReader(policy: AssetPolicy) {
  for (const [name, limit] of Object.entries({
    maxBytes: policy.maxBytes,
    maxTotalBytes: policy.maxTotalBytes,
    maxRequests: policy.maxRequests,
  })) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error(`Avatar ${name} must be a positive safe integer`);
  }
  const origins = new Set(
    policy.allowedOrigins.map((origin) => new URL(origin).origin),
  );
  const request = policy.fetch ?? globalThis.fetch;
  return () => {
    let totalBytes = 0;
    let requests = 0;
    return async (
      reference: string,
      signal: AbortSignal,
      base = policy.baseURL,
    ): Promise<Asset> => {
      const url = new URL(reference, base);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !origins.has(url.origin) ||
        url.username ||
        url.password
      ) {
        throw new Error(`Avatar asset is not admitted: ${url.origin}`);
      }
      requests += 1;
      if (requests > policy.maxRequests)
        throw new Error("Avatar asset request limit reached");
      // Reject redirects before a browser can contact an unapproved destination.
      const response = await request(url.href, { signal, redirect: "error" });
      if (!response.ok)
        throw new Error(
          `Avatar asset request failed: ${String(response.status)}`,
        );
      const declaredSize = Number(response.headers.get("content-length"));
      if (
        declaredSize > policy.maxBytes ||
        declaredSize > policy.maxTotalBytes - totalBytes
      ) {
        await response.body?.cancel();
        throw new Error("Avatar asset exceeds the byte limit");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Avatar asset has no response body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > policy.maxBytes)
            throw new Error("Avatar asset exceeds the byte limit");
          if (chunk.value.byteLength > policy.maxTotalBytes - totalBytes)
            throw new Error("Avatar selection exceeds the total byte limit");
          totalBytes += chunk.value.byteLength;
          chunks.push(chunk.value);
        }
      } catch (error) {
        const cancellation = await reader.cancel().then(
          () => ({ kind: "cancelled" as const }),
          (cause: unknown) => ({
            kind: "failed" as const,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          }),
        );
        if (cancellation.kind === "failed") {
          throw new AggregateError(
            [error, cancellation.error],
            "Avatar asset read and cancellation failed",
            { cause: error },
          );
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        url: url.href,
        bytes,
        contentType:
          response.headers.get("content-type") ?? "application/octet-stream",
      };
    };
  };
}
