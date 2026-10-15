// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountMycelium, type PixiModule } from "./mycelium.js";

type Recorded = { segments: number; renders: number; started: number };

function fakePixi(recorded: Recorded): PixiModule {
  class Graphics {
    alpha = 1;
    position = { set: () => undefined };
    scale = { set: () => undefined };
    moveTo() {
      return this;
    }
    lineTo() {
      recorded.segments += 1;
      return this;
    }
    stroke() {
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
