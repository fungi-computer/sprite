// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { customizationSchema } from "./customization.js";
import { characterSchema } from "./document.js";
import { createSprite, type NativePlayer } from "./player.js";
import {
  createRenderStyleLayer,
  renderStyleSchema,
  renderStyles,
  type RenderStyle,
} from "./render-style.js";

const fixture = characterSchema.parse({
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
const nativePlayer = (): NativePlayer => ({
  activities: ["idle"],
  expressions: ["normal"],
  set: vi.fn(),
  pause: vi.fn(),
});
const service = () =>
  createSprite({
    characters: {
      fixture: () =>
        Promise.resolve({
          document: fixture,
          render: () => Effect.succeed(nativePlayer()),
        }),
    },
  });
const filterOf = (stage: HTMLElement) =>
  /^url\("?#([^")]+)"?\)$/.exec(stage.style.filter)?.[1];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("render style parsing", () => {
  it("admits every named style and rejects anything else", () => {
    for (const style of renderStyles)
      expect(renderStyleSchema.parse(style)).toBe(style);
    expect(renderStyleSchema.safeParse("sepia").success).toBe(false);
    expect(renderStyleSchema.safeParse("Pencil").success).toBe(false);
    expect(renderStyleSchema.safeParse(undefined).success).toBe(false);
  });

  it("defaults a saved customization to plain and rejects extra keys", () => {
    expect(customizationSchema.parse({})).toEqual({ renderStyle: "plain" });
    expect(
      customizationSchema.parse({
        renderStyle: "riso",
        appearance: { cap: "#ff0000" },
      }),
    ).toEqual({ renderStyle: "riso", appearance: { cap: "#ff0000" } });
    expect(customizationSchema.safeParse({ renderStyle: "neon" }).success).toBe(
      false,
    );
    expect(customizationSchema.safeParse({ filter: "pencil" }).success).toBe(
      false,
    );
  });
});

describe("render style layer", () => {
  const mounted = () => {
    const host = document.createElement("div");
    const stage = document.createElement("div");
    host.append(stage);
    document.body.append(host);
    return { host, stage, layer: createRenderStyleLayer(host) };
  };

  it("gives two sprites on one page distinct filters", () => {
    const first = mounted();
    const second = mounted();
    first.layer.set("pencil", first.stage);
    second.layer.set("pencil", second.stage);
    const firstName = filterOf(first.stage);
    const secondName = filterOf(second.stage);
    expect(firstName).toBeTruthy();
    expect(firstName).not.toBe(secondName);
    for (const [{ host }, name] of [
      [first, firstName],
      [second, secondName],
    ] as const) {
      expect(document.querySelectorAll(`[id="${String(name)}"]`)).toHaveLength(
        1,
      );
      expect(host.querySelector("filter")?.id).toBe(name);
    }
    first.layer.set("plain", first.stage);
    expect(first.stage.style.filter).toBe("");
    expect(first.host.querySelector("filter")).toBeNull();
    expect(second.host.querySelector("filter")?.id).toBe(secondName);
    second.layer.dispose();
    expect(document.querySelector("filter")).toBeNull();
  });

  it("defines a filter for every style except plain", () => {
    const host = document.createElement("div");
    const stage = document.createElement("div");
    document.body.append(host);
    const layer = createRenderStyleLayer(host);
    for (const style of renderStyles) {
      layer.set(style, stage);
      const filter = host.querySelector("filter");
      if (style === "plain") expect(filter).toBeNull();
      else {
        expect(filter?.children.length).toBeGreaterThan(2);
        expect(filterOf(stage)).toBe(filter?.id);
      }
    }
    layer.dispose();
  });

  it("draws pencil at the one firm pressure", () => {
    const { host, stage, layer } = mounted();
    const pressure = () => ({
      opacity: host
        .querySelector("feFlood:last-of-type")
        ?.getAttribute("flood-opacity"),
      tooth: [...host.querySelectorAll("feColorMatrix")]
        .map((matrix) => matrix.getAttribute("values") ?? "")
        .find((values) => /(1\.55|1\.45)$/.test(values)),
    });
    layer.set("pencil", stage);
    const firm = pressure();
    expect(firm.opacity).toBe("1");
    layer.dispose();
  });

  it("boils only while visible, on screen, and in motion", () => {
    vi.useFakeTimers();
    let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    const host = document.createElement("div");
    const stage = document.createElement("div");
    document.body.append(host);
    const layer = createRenderStyleLayer(host);
    layer.set("pencil", stage);
    const seed = () =>
      host.querySelector('[data-sprite-boil="wobble"]')?.getAttribute("seed");
    const seeds = new Set<string | null | undefined>();
    for (let step = 0; step < 4; step += 1) {
      vi.advanceTimersByTime(160);
      seeds.add(seed());
    }
    expect(seeds.size).toBeGreaterThan(1);

    const frozen = () => {
      const before = seed();
      vi.advanceTimersByTime(640);
      return seed() === before;
    };
    layer.still(true);
    expect(frozen()).toBe(true);
    layer.still(false);
    report?.([{ isIntersecting: false }]);
    expect(frozen()).toBe(true);
    report?.([{ isIntersecting: true }]);
    expect(frozen()).toBe(false);
    layer.dispose();
  });
});

describe("player render style", () => {
  it("draws only the sprite box and validates the style at the boundary", async () => {
    const sprite = service();
    const mount = () => {
      const target = document.createElement("div");
      document.body.append(target);
      const player = sprite.mount(target);
      player.set({ src: { local: "fixture" }, renderStyle: "manga" });
      const stage = () => target.querySelector<HTMLElement>(":scope > div");
      return { target, player, stage };
    };
    const first = mount();
    const second = mount();
    await vi.waitFor(() => {
      expect(first.player.state.status).toBe("ready");
      expect(second.player.state.status).toBe("ready");
    });
    const firstStage = first.stage();
    const secondStage = second.stage();
    if (!firstStage || !secondStage) throw new Error("Sprite stage missing");
    expect(filterOf(firstStage)).toBeTruthy();
    expect(filterOf(firstStage)).not.toBe(filterOf(secondStage));
    expect(first.target.style.filter).toBe("");
    const presented = () =>
      first.player.state.status === "ready"
        ? first.player.state.presentation.renderStyle
        : null;
    expect(presented()).toBe("manga");

    // SAFETY: simulates an unchecked saved value reaching the player.
    const unknown = "sepia" as RenderStyle;
    first.player.set({ src: { local: "fixture" }, renderStyle: unknown });
    expect(
      first.player.state.status === "ready"
        ? first.player.state.updateError?.message
        : null,
    ).toMatch(/Invalid option/);
    expect(filterOf(firstStage)).toBeTruthy();

    first.player.set({ src: { local: "fixture" } });
    expect(firstStage.style.filter).toBe("");
    expect(presented()).toBe("plain");
    await Promise.all([first.player.dispose(), second.player.dispose()]);
    expect(document.querySelector("filter")).toBeNull();
  });
});
