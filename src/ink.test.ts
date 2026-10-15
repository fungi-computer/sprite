// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { mountInkDrawing, type InkArt } from "./ink.js";

const art: InkArt = {
  width: 100,
  height: 50,
  ink: [
    [0, 0, 2, 10, 0, 2, 20, 5, 2],
    [30, 30, 1, 40, 35, 1],
  ],
  coral: [[50, 10, 3, 60, 12, 3]],
  fills: {
    ink: [
      [
        [0, 0, 10, 0, 10, 10, 0, 10],
        [2, 2, 4, 2, 4, 4],
      ],
      [[20, 20, 30, 20, 30, 30]],
    ],
    coral: [[[40, 40, 50, 40, 50, 45]]],
  },
  dots: [70, 40, 1, 72, 42, 1.2],
};

type Calls = {
  strokes: string[];
  rects: string[];
  arcs: number;
  rules: string[];
};

function recordingCanvasContext(
  canvas: HTMLCanvasElement,
  calls: Calls,
): CanvasRenderingContext2D {
  const unused = (): never => {
    throw new Error("Canvas operation is unused in this drawing proof");
  };
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    lineDashOffset: 0,
    miterLimit: 10,
    shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    direction: "inherit",
    font: "10px sans-serif",
    fontKerning: "auto",
    fontStretch: "normal",
    fontVariantCaps: "normal",
    letterSpacing: "0px",
    textAlign: "start",
    textBaseline: "alphabetic",
    textRendering: "auto",
    wordSpacing: "0px",
    drawImage: unused,
    clip: unused,
    isPointInPath: unused,
    isPointInStroke: unused,
    createConicGradient: unused,
    createLinearGradient: unused,
    createPattern: unused,
    createRadialGradient: unused,
    createImageData: unused,
    getImageData: unused,
    putImageData: unused,
    arcTo: unused,
    bezierCurveTo: unused,
    ellipse: unused,
    quadraticCurveTo: unused,
    rect: unused,
    roundRect: unused,
    getLineDash: unused,
    setLineDash: unused,
    fillRect: unused,
    strokeRect: unused,
    getContextAttributes: unused,
    isContextLost: unused,
    reset: unused,
    restore: unused,
    save: unused,
    fillText: unused,
    measureText: unused,
    strokeText: unused,
    getTransform: unused,
    resetTransform: unused,
    rotate: unused,
    scale: unused,
    transform: unused,
    translate: unused,
    drawFocusIfNeeded: unused,

    setTransform: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => {
      calls.arcs += 1;
    },
    stroke() {
      calls.strokes.push(z.string().parse(this.strokeStyle));
    },
    closePath: () => undefined,
    fill(rule?: CanvasFillRule | Path2D) {
      if (rule === "evenodd" || rule === "nonzero") {
        calls.rects.push(z.string().parse(this.fillStyle));
        calls.rules.push(rule);
      }
    },
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
  };
}

function stubCanvas(calls: Calls) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") return null;
      return recordingCanvasContext(this, calls);
    },
  );
}

function stubBrowser() {
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList => ({
    matches: query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }));
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mountInkDrawing", () => {
  it("paints the finished drawing at once for reduced motion", () => {
    stubBrowser();
    const calls: Calls = { strokes: [], rects: [], arcs: 0, rules: [] };
    stubCanvas(calls);
    const host = document.createElement("div");
    const drawing = mountInkDrawing(host, {
      art,
      palette: () => ({ ink: "ink", coral: "coral" }),
    });
    const canvas = host.querySelector("canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    // Three ink segments and one coral segment, ink first.
    expect(calls.strokes).toEqual(["ink", "ink", "ink", "coral"]);
    expect(calls.rects).toEqual(["ink", "ink", "coral"]);
    expect(calls.rules).toEqual(["evenodd", "evenodd", "evenodd"]);
    expect(calls.arcs).toBe(2);
    drawing.destroy();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("repaints in the new palette on redraw", () => {
    stubBrowser();
    const calls: Calls = { strokes: [], rects: [], arcs: 0, rules: [] };
    stubCanvas(calls);
    let ink = "ink";
    const drawing = mountInkDrawing(document.createElement("div"), {
      art,
      palette: () => ({ ink, coral: "coral" }),
    });
    calls.strokes.length = 0;
    ink = "cream";
    drawing.redraw();
    expect(calls.strokes.slice(0, 3)).toEqual(["cream", "cream", "cream"]);
    drawing.destroy();
  });
});
