// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { act, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { characterSchema } from "./document.js";
import { createSprite, type NativePlayer, type PlayerState } from "./player.js";
import { Sprite, SpriteProvider } from "./react.js";

const document = characterSchema.parse({
  version: 1,
  name: "Fixture",
  renderer: "fixture",
  controls: {},
  data: {},
});

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

describe("Sprite React host", () => {
  it("survives StrictMode remount and keeps one host for presentation edits", async () => {
    const release = vi.fn();
    const set = vi.fn();
    const service = createSprite({
      assets: {
        baseURL: "https://art.example/",
        allowedOrigins: ["https://art.example"],
        maxBytes: 1024,
        maxTotalBytes: 4096,
        maxRequests: 8,
      },
      renderers: {},
      characters: {
        fixture: () =>
          Promise.resolve({
            document,
            render: () =>
              Effect.acquireRelease(
                Effect.succeed({
                  activities: ["idle", "speaking"],
                  expressions: ["normal"],
                  set,
                  pause: vi.fn(),
                }),
                () => Effect.sync(release),
              ),
          }),
      },
    });
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const ref = createRef<HTMLDivElement>();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <SpriteProvider service={service}>
            <Sprite ref={ref} src={{ local: "fixture" }} activity="idle" />
          </SpriteProvider>
        </StrictMode>,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(ref.current?.dataset.spriteStatus).toBe("ready");
    });
    const host = ref.current;
    await act(async () => {
      root.render(
        <StrictMode>
          <SpriteProvider service={service}>
            <Sprite ref={ref} src={{ local: "fixture" }} activity="speaking" />
          </SpriteProvider>
        </StrictMode>,
      );
      await Promise.resolve();
    });
    expect(ref.current).toBe(host);
    await vi.waitFor(() => {
      expect(set).toHaveBeenLastCalledWith(
        expect.objectContaining({ activity: "speaking" }),
      );
    });
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalled();
    });
    container.remove();
  });

  it("passes the performance prop to the renderer and delivers progress through onState", async () => {
    const performance = { scene: "one" };
    const set = vi.fn<NativePlayer["set"]>();
    const service = createSprite({
      characters: {
        fixture: () =>
          Promise.resolve({
            document,
            render: (context) => {
              context.reportProgress({ beat: 1 });
              return Effect.succeed({
                activities: ["idle"],
                expressions: ["normal"],
                set,
                pause: vi.fn(),
              });
            },
          }),
      },
    });
    const states: PlayerState[] = [];
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sprite
          service={service}
          src={{ local: "fixture" }}
          performance={performance}
          onState={(state) => states.push(state)}
        />,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(states.at(-1)).toMatchObject({
        status: "ready",
        progress: { beat: 1 },
      });
    });
    expect(set.mock.calls[0]?.[0].performance).toBe(performance);
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
  });
});
