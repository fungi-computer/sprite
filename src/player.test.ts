// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { describe, expect, it, vi, type Mock } from "vitest";

import { characterSchema } from "./document.js";
import { createSprite, type NativePlayer, type Renderer } from "./player.js";

const document = characterSchema.parse({
  version: 1,
  name: "Fixture",
  renderer: "fixture",
  controls: { color: { type: "color", label: "Color", default: "#ffffff" } },
  data: {},
});
const assets = {
  baseURL: "https://art.example/",
  allowedOrigins: ["https://art.example"],
  maxBytes: 1024,
  maxTotalBytes: 4096,
  maxRequests: 8,
};

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn((media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })),
});

function native(): Omit<NativePlayer, "set" | "pause"> & {
  readonly set: Mock<NativePlayer["set"]>;
  readonly pause: Mock<NativePlayer["pause"]>;
} {
  return {
    activities: ["idle", "speaking"],
    expressions: ["normal"],
    set: vi.fn<NativePlayer["set"]>(),
    pause: vi.fn<NativePlayer["pause"]>(),
  };
}

function renderer(value: NativePlayer, release: () => void): Renderer {
  return () =>
    Effect.acquireRelease(Effect.succeed(value), () => Effect.sync(release));
}

async function ready(
  player: ReturnType<ReturnType<typeof createSprite>["mount"]>,
) {
  await vi.waitFor(() => {
    expect(player.state.status).toBe("ready");
  });
}

describe("scoped Sprite player", () => {
  it("updates one native instance without remounting or restarting equal states", async () => {
    const value = native();
    const release = vi.fn();
    const load = vi.fn(() =>
      Promise.resolve({
        document,
        render: renderer(value, release),
      }),
    );
    const player = createSprite({
      assets,
      renderers: {},
      characters: { fixture: load },
    }).mount(window.document.createElement("div"));
    player.set({ src: { local: "fixture" }, activity: "idle" });
    await ready(player);
    const observer = vi.fn();
    player.subscribe(observer);
    player.set({ src: { local: "fixture" }, activity: "idle" });
    expect(value.set).toHaveBeenCalledTimes(1);
    expect(observer).not.toHaveBeenCalled();
    player.set({
      src: { local: "fixture" },
      activity: "speaking",
      appearance: { color: "#ff0000" },
    });
    expect(value.set).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
    await player.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("surfaces prior cleanup failure before reopening the same host", async () => {
    const cleanupError = new Error("native cleanup failed");
    const target = window.document.createElement("div");
    const service = createSprite({
      assets,
      renderers: {},
      characters: {
        fixture: () =>
          Promise.resolve({
            document,
            render: () =>
              Effect.acquireRelease(Effect.succeed(native()), () =>
                Effect.sync(() => {
                  throw cleanupError;
                }),
              ),
          }),
      },
    });
    const first = service.mount(target);
    first.set({ src: { local: "fixture" } });
    await ready(first);

    await expect(first.dispose()).rejects.toBe(cleanupError);

    const next = service.mount(target);
    next.set({ src: { local: "fixture" } });
    await vi.waitFor(() => {
      expect(next.state).toMatchObject({
        status: "error",
        error: cleanupError,
      });
    });
  });

  it("preserves the applied image when an appearance edit is invalid", async () => {
    const value = native();
    const player = createSprite({
      assets,
      renderers: {},
      characters: {
        fixture: () =>
          Promise.resolve({ document, render: renderer(value, vi.fn()) }),
      },
    }).mount(window.document.createElement("div"));
    player.set({ src: { local: "fixture" } });
    await ready(player);
    const observer = vi.fn();
    player.subscribe(observer);
    player.set({ src: { local: "fixture" }, appearance: { color: "bad" } });
    expect(player.state.status).toBe("ready");
    if (player.state.status === "ready")
      expect(player.state.updateError).toBeInstanceOf(Error);
    expect(value.set).toHaveBeenCalledTimes(1);
    player.set({ src: { local: "fixture" }, appearance: { color: "bad" } });
    expect(observer).toHaveBeenCalledTimes(1);
    player.set({ src: { local: "fixture" } });
    expect(player.state).not.toHaveProperty("updateError");
    expect(value.set).toHaveBeenCalledTimes(1);
    await player.dispose();
  });

  it("reports changed fallback requests without restarting equal native states", async () => {
    const value = native();
    const player = createSprite({
      characters: {
        fixture: () =>
          Promise.resolve({ document, render: renderer(value, vi.fn()) }),
      },
    }).mount(window.document.createElement("div"));
    player.set({ src: { local: "fixture" }, activity: "idle" });
    await ready(player);
    const observer = vi.fn();
    player.subscribe(observer);
    player.set({
      src: { local: "fixture" },
      activity: "unsupported",
      expression: "missing",
    });
    expect(player.state).toMatchObject({
      status: "ready",
      presentation: {
        requestedActivity: "unsupported",
        requestedExpression: "missing",
        activity: "idle",
        expression: "normal",
        fallback: true,
      },
    });
    expect(observer).toHaveBeenCalledTimes(1);
    player.set({
      src: { local: "fixture" },
      activity: "unsupported",
      expression: "missing",
    });
    expect(observer).toHaveBeenCalledTimes(1);
    player.set({ src: { local: "fixture" }, activity: "idle" });
    expect(player.state).toMatchObject({
      presentation: { requestedActivity: "idle", fallback: false },
    });
    expect(value.set).toHaveBeenCalledTimes(1);
    await player.dispose();
  });

  it("interrupts a slow selection and releases it before a replacement opens", async () => {
    const order: string[] = [];
    const slow: Renderer = () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            order.push("acquire slow");
            return {};
          }),
          () =>
            Effect.sync(() => {
              order.push("release slow");
            }),
        );
        yield* Effect.tryPromise({
          try: () => new Promise<void>(() => undefined),
          catch: () => new Error("slow"),
        });
        return native();
      });
    const fast: Renderer = () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          order.push("acquire fast");
          return native();
        }),
        () =>
          Effect.sync(() => {
            order.push("release fast");
          }),
      );
    const player = createSprite({
      assets,
      renderers: {},
      characters: {
        slow: () => Promise.resolve({ document, render: slow }),
        fast: () => Promise.resolve({ document, render: fast }),
      },
    }).mount(window.document.createElement("div"));
    player.set({ src: { local: "slow" } });
    await vi.waitFor(() => {
      expect(order).toContain("acquire slow");
    });
    player.set({ src: { local: "fast" } });
    await ready(player);
    expect(order).toEqual(["acquire slow", "release slow", "acquire fast"]);
    await player.dispose();
    expect(order.at(-1)).toBe("release fast");
  });

  it("reuses a host after dispose without stale cleanup clearing the new child", async () => {
    const target = window.document.createElement("div");
    const service = createSprite({
      assets,
      renderers: {},
      characters: {
        fixture: () =>
          Promise.resolve({
            document,
            render: renderer(native(), vi.fn()),
          }),
      },
    });
    const old = service.mount(target);
    old.set({ src: { local: "fixture" } });
    await ready(old);
    const closed = old.dispose();
    const next = service.mount(target);
    next.set({ src: { local: "fixture" } });
    await ready(next);
    await closed;
    expect(target.children).toHaveLength(1);
    await next.dispose();
  });

  it("waits for failed native cleanup before opening the replacement", async () => {
    const first = native();
    const firstSet = first.set;
    firstSet
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("native update failed");
      });
    let finishRelease: (() => void) | undefined;
    const fastLoad = vi.fn(() =>
      Promise.resolve({
        document,
        render: renderer(native(), vi.fn()),
      }),
    );
    const player = createSprite({
      assets,
      renderers: {},
      characters: {
        old: () =>
          Promise.resolve({
            document,
            render: () =>
              Effect.acquireRelease(Effect.succeed(first), () =>
                Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      finishRelease = resolve;
                    }),
                ),
              ),
          }),
        fast: fastLoad,
      },
    }).mount(window.document.createElement("div"));
    player.set({ src: { local: "old" } });
    await ready(player);
    player.set({ src: { local: "old" }, activity: "speaking" });
    expect(player.state.status).toBe("error");
    player.set({ src: { local: "fast" } });
    await vi.waitFor(() => {
      expect(finishRelease).toBeTypeOf("function");
    });
    expect(fastLoad).not.toHaveBeenCalled();
    finishRelease?.();
    await ready(player);
    expect(fastLoad).toHaveBeenCalledTimes(1);
    await player.dispose();
  });
});

it.each([
  new Error("loader failed", { cause: new Error("nested failure") }),
  { reason: "renderer failed" },
])(
  "publishes the original renderer failure to state observers",
  async (cause) => {
    const player = createSprite({
      assets,
      renderers: {},
      characters: {
        fixture: () =>
          Promise.resolve({ document, render: () => Effect.die(cause) }),
      },
    }).mount(window.document.createElement("div"));
    const observer = vi.fn();
    const unsubscribe = player.subscribe(observer);
    try {
      player.set({ src: { local: "fixture" } });
      await vi.waitFor(() => {
        expect(player.state.status).toBe("error");
      });
      const state = player.state;
      if (state.status !== "error") throw new Error("Missing failure state");
      if (cause instanceof Error) expect(state.error).toBe(cause);
      else {
        expect(Object.hasOwn(state.error, "cause")).toBe(true);
        expect(state.error.cause).toBe(cause);
      }
      expect(observer).toHaveBeenCalledWith(state);
    } finally {
      unsubscribe();
      await player.dispose();
    }
  },
);
