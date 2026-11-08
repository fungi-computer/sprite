// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountMycelium, type PixiModule } from "./mycelium.js";

type Recorded = { segments: number; renders: number; started: number };
type Stroke = { x: number; y: number; width: number };

function fakePixi(recorded: Recorded, strokes: Stroke[] = []): PixiModule {
  let end = { x: 0, y: 0 };
  class Graphics {
    alpha = 1;
    position = { set: () => undefined };
    scale = { set: () => undefined };
    moveTo() {
      return this;
    }
    lineTo(x: number, y: number) {
      recorded.segments += 1;
      end = { x, y };
      return this;
    }
    stroke(style: { width: number }) {
      strokes.push({ ...end, width: style.width });
      return this;
    }
    circle() {
      return this;
    }
    fill() {
      return this;
    }
    clear() {
      return this;
    }
    destroy() {
      return undefined;
    }
  }
  const texture = { destroy: () => undefined };
  class Application {
    canvas = document.createElement("canvas");
    screen = { width: 1200, height: 600 };
    renderer = {
      resolution: 1,
      render: () => {
        recorded.renders += 1;
      },
    };
    stage = { addChild: () => undefined };
    ticker = {
      deltaMS: 16,
      add: () => undefined,
      start: () => {
        recorded.started += 1;
      },
      stop: () => undefined,
    };
    init() {
      return Promise.resolve();
    }
    render() {
      return undefined;
    }
    destroy() {
      this.canvas.remove();
    }
  }
  return {
    Application,
    Container: class {
      addChild() {
        return undefined;
      }
    },
    Graphics,
    Sprite: class {
      constructor(public texture: { destroy(): void }) {}
    },
    RenderTexture: { create: () => texture },
  };
}

function stubBrowser(reduce: boolean) {
  // SAFETY: the field only reads `matches` from the stubbed media query.
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: reduce && query.includes("reduce") }) as MediaQueryList,
  );
  class Observer {
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", Observer);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mountMycelium", () => {
  it("grows the whole network into one still frame for reduced motion", async () => {
    stubBrowser(true);
    const recorded: Recorded = { segments: 0, renders: 0, started: 0 };
    const host = document.createElement("div");
    const field = await mountMycelium(host, {
      pixi: fakePixi(recorded),
      palette: { thread: "#4c4f69", node: "#f98284" },
      segments: 400,
    });
    expect(host.querySelector("canvas")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(recorded.segments).toBeGreaterThan(0);
    expect(recorded.segments).toBeLessThanOrEqual(400 + 200);
    expect(recorded.renders).toBe(1);
    expect(recorded.started).toBe(0);
    field.destroy();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("thins threads to points instead of cutting them at an edge", async () => {
    stubBrowser(true);
    const recorded: Recorded = { segments: 0, renders: 0, started: 0 };
    const strokes: Stroke[] = [];
    const avoided = { left: 500, top: 0, right: 700, bottom: 600 };
    (
      await mountMycelium(document.createElement("div"), {
        pixi: fakePixi(recorded, strokes),
        palette: { thread: "#4c4f69", node: "#f98284" },
        segments: 3000,
        margin: 30,
        avoid: () => [avoided],
      })
    ).destroy();
    const near = strokes.filter(
      ({ x, y }) =>
        Math.min(
          x,
          y,
          1200 - x,
          600 - y,
          Math.abs(x - 500),
          Math.abs(x - 700),
        ) < 3,
    );
    expect(strokes.length).toBeGreaterThan(0);
    for (const { x, y, width } of strokes) {
      expect(x > avoided.left && x < avoided.right).toBe(false);
      expect(x >= 0 && x <= 1200 && y >= 0 && y <= 600).toBe(true);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(1.6);
    }
    for (const { width } of near) expect(width).toBeLessThan(0.2);
  });

  it("repeats the same network for the same seed", async () => {
    stubBrowser(true);
    const first: Recorded = { segments: 0, renders: 0, started: 0 };
    const second: Recorded = { segments: 0, renders: 0, started: 0 };
    const options = {
      palette: { thread: "#4c4f69", node: "#f98284" },
      seed: 42,
      segments: 300,
    };
    (
      await mountMycelium(document.createElement("div"), {
        ...options,
        pixi: fakePixi(first),
      })
    ).destroy();
    (
      await mountMycelium(document.createElement("div"), {
        ...options,
        pixi: fakePixi(second),
      })
    ).destroy();
    expect(second.segments).toBe(first.segments);
  });
});
