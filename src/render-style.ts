import { correlationKey } from "@fungi.computer/cairn";
import * as z from "zod";

/**
 * Render styles: an SVG filter drawn over a mounted Sprite. This module owns
 * the style vocabulary, every filter definition, and the DOM layer that mounts
 * one filter per player with ids unique to that player.
 */
export const renderStyles = [
  "plain",
  "pencil",
  "manga",
  "riso",
  "halftone",
  "blueprint",
  "crt",
  "watercolor",
] as const;

/** A saved render style; unknown names fail at the boundary. */
export const renderStyleSchema = z.enum(renderStyles);

/** How a Sprite is drawn over its native renderer. */
export type RenderStyle = z.infer<typeof renderStyleSchema>;

/** Picker labels for each style, in display order. */
export const renderStyleLabels = {
  plain: "Plain",
  pencil: "Pencil",
  manga: "Manga",
  riso: "Riso",
  halftone: "Halftone",
  blueprint: "Blueprint",
  crt: "CRT",
  watercolor: "Watercolor",
} as const satisfies Record<RenderStyle, string>;

// Theme tokens. A host may pin any of these with the --sprite-* property.
const tone = {
  ink: "var(--sprite-ink, var(--color-base-content, #1c1c1a))",
  paper: "var(--sprite-paper, var(--color-base-100, #fbfaf6))",
  accent: "var(--sprite-accent, var(--color-accent, #d20f39))",
  risoFirst: "var(--sprite-riso-first, var(--color-info, #1e66f5))",
  risoSecond: "var(--sprite-riso-second, var(--color-accent, #ea76cb))",
  blueprint:
    "var(--sprite-blueprint, color-mix(in oklab, var(--color-info, #1e66f5) 55%, #0b2350))",
  blueprintLine:
    "var(--sprite-blueprint-line, color-mix(in oklab, var(--color-info-content, #ffffff) 25%, #ffffff))",
  screen:
    "var(--sprite-screen, color-mix(in oklab, var(--color-base-content, #111111) 12%, #050805))",
  phosphor: "var(--sprite-phosphor, var(--color-success, #40a02b))",
} as const;

type Attributes = Readonly<Record<string, string | number>>;
type Primitive = {
  readonly tag: string;
  readonly attributes: Attributes;
  readonly children: readonly Primitive[];
};
type Track = {
  /** `data-sprite-boil` name of the animated primitive. */
  readonly name: string;
  readonly attribute: string;
  readonly frames: readonly (string | number)[];
};
/** One style's filter: its region, primitives, and optional boil. */
type FilterDefinition = {
  readonly region: Attributes;
  readonly primitives: readonly Primitive[];
  readonly boil?: { readonly intervalMs: number; readonly tracks: Track[] };
};

const p = (
  tag: string,
  attributes: Attributes = {},
  ...children: Primitive[]
): Primitive => ({ tag, attributes, children });
const flood = (color: string, result: string, opacity = 1) =>
  p("feFlood", {
    style: `flood-color: ${color}`,
    "flood-opacity": opacity,
    result,
  });
const tile = (svg: string, size: number, result: string) => [
  p("feImage", {
    href: `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${String(size)}' height='${String(size)}'>${svg}</svg>`,
    )}`,
    width: size,
    height: size,
    result: `${result}Cell`,
  }),
  p("feTile", { in: `${result}Cell`, result }),
];
const alphaMatrix = (values: string, input: string, result: string) =>
  p("feColorMatrix", {
    in: input,
    type: "matrix",
    values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${values}`,
    result,
  });
/** Darkness as alpha: paper-white is clear, black is opaque. */
const darkness = (input: string, result: string) =>
  alphaMatrix("-0.333 -0.333 -0.333 1 0", input, result);
/** Laplacian contour of the value masses. */
const contour = (
  input: string,
  result: string,
  weight: number,
  outline = 1.1,
) => [
  p("feConvolveMatrix", {
    in: input,
    order: 3,
    kernelMatrix: "0 1 0 1 -4 1 0 1 0",
    result: `${result}In`,
  }),
  p("feConvolveMatrix", {
    in: input,
    order: 3,
    kernelMatrix: "0 -1 0 -1 4 -1 0 -1 0",
    result: `${result}Out`,
  }),
  p("feComposite", {
    in: `${result}In`,
    in2: `${result}Out`,
    operator: "arithmetic",
    k2: 1,
    k3: 1,
    result: `${result}Edges`,
  }),
  alphaMatrix(
    `${String(weight)} ${String(weight)} ${String(weight)} ${String(outline)} 0`,
    `${result}Edges`,
    result,
  ),
];
/**
 * Line art for the non-pencil styles: interior value edges (the convolution
 * keeps opacity, so edges inside the figure survive premultiplication) plus
 * an outline ring around the silhouette.
 */
const lineArt = (
  input: string,
  result: string,
  weight: number,
  outline: number,
) => [
  p("feConvolveMatrix", {
    in: input,
    order: 3,
    kernelMatrix: "0 1 0 1 -4 1 0 1 0",
    preserveAlpha: "true",
    result: `${result}In`,
  }),
  p("feConvolveMatrix", {
    in: input,
    order: 3,
    kernelMatrix: "0 -1 0 -1 4 -1 0 -1 0",
    preserveAlpha: "true",
    result: `${result}Out`,
  }),
  p("feComposite", {
    in: `${result}In`,
    in2: `${result}Out`,
    operator: "arithmetic",
    k2: 1,
    k3: 1,
    result: `${result}Edges`,
  }),
  alphaMatrix(
    `${String(weight)} ${String(weight)} ${String(weight)} 0 -0.15`,
    `${result}Edges`,
    `${result}Inner`,
  ),
  p("feMorphology", {
    in: input,
    operator: "dilate",
    radius: outline,
    result: `${result}Grown`,
  }),
  p("feComposite", {
    in: `${result}Grown`,
    in2: input,
    operator: "out",
    result: `${result}Ring`,
  }),
  alphaMatrix("0 0 0 1 0", `${result}Ring`, `${result}Outline`),
  merge(result, `${result}Inner`, `${result}Outline`),
];
const discrete = (input: string, table: string, result: string) =>
  p(
    "feComponentTransfer",
    { in: input, result },
    p("feFuncA", { type: "discrete", tableValues: table }),
  );
const merge = (result: string, ...inputs: string[]) =>
  p(
    "feMerge",
    { result },
    ...inputs.map((input) => p("feMergeNode", { in: input })),
  );
const paint = (color: string, mask: string, result: string, opacity = 1) => [
  flood(color, `${result}Flood`, opacity),
  p("feComposite", { in: `${result}Flood`, in2: mask, operator: "in", result }),
];
const fullBox = { x: "0%", y: "0%", width: "100%", height: "100%" } as const;
const bleedBox = { x: "-8%", y: "-8%", width: "116%", height: "116%" } as const;

/** Pencil pressure: how hard the graphite is laid down. */
type PencilPressure = {
  /** Gamma applied to the source values before tracing; 1 keeps them. */
  readonly value: number;
  /** Contour gain on value edges, and on the silhouette's edge. */
  readonly line: number;
  readonly outline: number;
  /** Hatch gains and thresholds for the mid and dark tones. */
  readonly midHatch: readonly [gain: number, threshold: number];
  readonly darkHatch: readonly [gain: number, threshold: number];
  /** Paper tooth: how much graphite skips. */
  readonly tooth: string;
  readonly opacity: number;
};

/** The one pencil pressure: firm lines and dense hatching, reads at 48px. */
const firmPressure: PencilPressure = {
  value: 1.6,
  line: 6,
  outline: 2.4,
  midHatch: [3.2, -0.05],
  darkHatch: [3.4, -0.4],
  tooth: "0 0 0 -0.7 1.45",
  opacity: 1,
};

/** Graphite over hatching; the light pressure is the shiit.app port. */
const pencil = (pressure: PencilPressure): FilterDefinition => ({
  region: bleedBox,
  primitives: [
    p(
      "feComponentTransfer",
      { in: "SourceGraphic", result: "valued" },
      ...["feFuncR", "feFuncG", "feFuncB"].map((channel) =>
        p(channel, {
          type: "gamma",
          amplitude: 1,
          exponent: pressure.value,
          offset: 0,
        }),
      ),
    ),
    // Wobble: the boil. Its seed changes a few times a second.
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.05,
      numOctaves: 2,
      seed: 1,
      result: "wobble",
      "data-sprite-boil": "wobble",
    }),
    p("feDisplacementMap", {
      in: "valued",
      in2: "wobble",
      scale: 2.6,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: "drawn",
    }),
    // Contour: edges of the value masses, traced as pencil lines.
    ...contour("drawn", "line", pressure.line, pressure.outline),
    // Value: how much graphite each area takes.
    darkness("drawn", "dark"),
    // Two hatch directions: mid tones take one, dark tones cross it.
    ...tile(
      "<path d='M-1 1l2-2M0 6l6-6M5 7l2-2' stroke='black' stroke-width='1.1'/>",
      6,
      "hatch45",
    ),
    p("feOffset", {
      in: "hatch45",
      dx: 0,
      dy: 0,
      result: "hatchOffset",
      "data-sprite-boil": "hatch",
    }),
    // Hand-laid strokes bend a little; a slow noise bends the tile.
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.07,
      numOctaves: 2,
      seed: 5,
      result: "strokeBend",
    }),
    p("feDisplacementMap", {
      in: "hatchOffset",
      in2: "strokeBend",
      scale: 4,
      xChannelSelector: "R",
      yChannelSelector: "B",
      result: "hatchA",
    }),
    ...tile(
      "<path d='M-1 4l2 2M0 0l5 5M4 -1l2 2' stroke='black' stroke-width='0.9'/>",
      5,
      "hatch135",
    ),
    p("feDisplacementMap", {
      in: "hatch135",
      in2: "strokeBend",
      scale: 3,
      xChannelSelector: "G",
      yChannelSelector: "R",
      result: "hatchB",
    }),
    p("feComposite", {
      in: "dark",
      in2: "hatchA",
      operator: "arithmetic",
      k1: pressure.midHatch[0],
      k4: pressure.midHatch[1],
      result: "shadeA",
    }),
    p("feComposite", {
      in: "dark",
      in2: "hatchB",
      operator: "arithmetic",
      k1: pressure.darkHatch[0],
      k4: pressure.darkHatch[1],
      result: "shadeB",
    }),
    // Grain: graphite skips over the paper's tooth.
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.9,
      numOctaves: 1,
      seed: 3,
      result: "tooth",
    }),
    alphaMatrix(pressure.tooth, "tooth", "toothMask"),
    // The darkest marks, eyes and mouth, are pressed in solid.
    alphaMatrix("0 0 0 6 -4.6", "dark", "solid"),
    merge("graphiteRaw", "solid", "shadeA", "shadeB", "line"),
    p("feComposite", {
      in: "graphiteRaw",
      in2: "toothMask",
      operator: "in",
      result: "graphite",
    }),
    ...paint(tone.ink, "graphite", "pencil", pressure.opacity),
  ],
  boil: {
    intervalMs: 160,
    tracks: [
      { name: "wobble", attribute: "seed", frames: [1, 2, 3] },
      { name: "hatch", attribute: "dx", frames: [0, 1, 2] },
    ],
  },
});

/** Brush contours, screentone dots on mid tones, and one accent colour. */
const manga: FilterDefinition = {
  region: bleedBox,
  primitives: [
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.04,
      numOctaves: 2,
      seed: 2,
      result: "brush",
      "data-sprite-boil": "brush",
    }),
    p("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "brush",
      scale: 2,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: "drawn",
    }),
    ...paint(tone.paper, "SourceAlpha", "paperFill"),
    darkness("drawn", "dark"),
    // Screentone: a dot sheet laid over the mid tones only.
    ...tile("<circle cx='2.5' cy='2.5' r='1.15' fill='black'/>", 5, "dots"),
    discrete("dark", "0 1 1 0", "midTone"),
    p("feComposite", {
      in: "dots",
      in2: "midTone",
      operator: "in",
      result: "tone",
    }),
    discrete("dark", "0 0 0 1", "solid"),
    // Accent: the most saturated areas take the one spot colour.
    alphaMatrix("3 -3 0 0 -0.35", "drawn", "satRG"),
    alphaMatrix("-3 3 0 0 -0.35", "drawn", "satGR"),
    alphaMatrix("0 3 -3 0 -0.35", "drawn", "satGB"),
    alphaMatrix("0 -3 3 0 -0.35", "drawn", "satBG"),
    merge("saturation", "satRG", "satGR", "satGB", "satBG"),
    discrete("saturation", "0 1", "accentMask"),
    ...paint(tone.accent, "accentMask", "accentFill"),
    // Brush line: a thick outline and swelling interior strokes.
    ...lineArt("drawn", "edge", 2, 2.2),
    p("feMorphology", {
      in: "edge",
      operator: "dilate",
      radius: 0.25,
      result: "stroke",
    }),
    merge("inkRaw", "tone", "solid", "stroke"),
    ...paint(tone.ink, "inkRaw", "ink"),
    merge("manga", "paperFill", "accentFill", "ink"),
  ],
  boil: {
    intervalMs: 180,
    tracks: [{ name: "brush", attribute: "seed", frames: [2, 4, 6] }],
  },
};

/** Two-ink duotone printed slightly out of register. */
const riso: FilterDefinition = {
  region: bleedBox,
  primitives: [
    alphaMatrix("-0.55 -0.55 -0.55 1.65 0", "SourceGraphic", "dark"),
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.85,
      numOctaves: 1,
      seed: 7,
      result: "grain",
    }),
    alphaMatrix("0 0 0 -0.9 1.35", "grain", "grainMask"),
    // First drum: the darks and mids, speckled by the drum's grain.
    p("feComposite", {
      in: "dark",
      in2: "grainMask",
      operator: "in",
      result: "firstMask",
    }),
    ...paint(tone.risoFirst, "firstMask", "firstInk", 0.92),
    // Second drum: warm and dark areas, everything short of paper-light.
    alphaMatrix("0 -1.9 0 1.9 0", "SourceGraphic", "secondMask"),
    ...paint(tone.risoSecond, "secondMask", "secondInk", 0.9),
    p("feOffset", {
      in: "firstInk",
      dx: -1.5,
      dy: 1,
      result: "firstPlate",
      "data-sprite-boil": "register",
    }),
    p("feOffset", {
      in: "secondInk",
      dx: 1.5,
      dy: -0.5,
      result: "secondPlate",
    }),
    p("feBlend", { in: "firstPlate", in2: "secondPlate", mode: "multiply" }),
  ],
  boil: {
    intervalMs: 240,
    tracks: [{ name: "register", attribute: "dx", frames: [-1.5, -1, -2] }],
  },
};

/** Round dots whose size follows the value underneath. */
const halftone: FilterDefinition = {
  region: bleedBox,
  primitives: [
    alphaMatrix("-0.5 -0.5 -0.5 1.65 0", "SourceGraphic", "value"),
    // Even paper-light areas keep a fine dot so the figure never vanishes.
    alphaMatrix("0 0 0 0.16 0", "SourceGraphic", "floor"),
    merge("dark", "floor", "value"),
    ...tile(
      "<defs><radialGradient id='d'><stop offset='0' stop-opacity='1'/><stop offset='1' stop-opacity='0'/></radialGradient></defs><rect width='6' height='6' fill='url(#d)'/>",
      6,
      "screen",
    ),
    p("feComposite", {
      in: "dark",
      in2: "screen",
      operator: "arithmetic",
      k2: 1,
      k3: 1,
      k4: -0.92,
      result: "dotField",
    }),
    p(
      "feComponentTransfer",
      { in: "dotField", result: "dotsRaw" },
      p("feFuncA", { type: "linear", slope: 12, intercept: 0 }),
    ),
    p("feComposite", {
      in: "dotsRaw",
      in2: "SourceAlpha",
      operator: "in",
      result: "dots",
    }),
    ...paint(tone.ink, "dots", "halftone"),
  ],
};

/** White drafting lines on blueprint blue. */
const blueprint: FilterDefinition = {
  region: fullBox,
  primitives: [
    flood(tone.blueprint, "ground"),
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.05,
      numOctaves: 1,
      seed: 4,
      result: "hand",
      "data-sprite-boil": "hand",
    }),
    p("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "hand",
      scale: 1.6,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: "drawn",
    }),
    ...tile(
      "<path d='M0 0.5h16M0.5 0v16' stroke='black' stroke-width='1' stroke-opacity='0.22'/>",
      16,
      "grid",
    ),
    ...paint(tone.blueprintLine, "grid", "gridLines"),
    ...paint(tone.blueprintLine, "SourceAlpha", "wash", 0.12),
    ...lineArt("drawn", "edge", 3, 1.2),
    p("feMorphology", {
      in: "edge",
      operator: "dilate",
      radius: 0.3,
      result: "stroke",
    }),
    ...paint(tone.blueprintLine, "stroke", "lines"),
    merge("blueprint", "ground", "gridLines", "wash", "lines"),
  ],
  boil: {
    intervalMs: 200,
    tracks: [{ name: "hand", attribute: "seed", frames: [4, 5, 6] }],
  },
};

/** A phosphor tube: glowing monochrome, bloom, and rolling scanlines. */
const crt: FilterDefinition = {
  region: fullBox,
  primitives: [
    flood(tone.screen, "ground"),
    p("feColorMatrix", {
      in: "SourceGraphic",
      type: "luminanceToAlpha",
      result: "lumRaw",
    }),
    p("feComposite", {
      in: "lumRaw",
      in2: "SourceAlpha",
      operator: "in",
      result: "lum",
    }),
    p(
      "feComponentTransfer",
      { in: "lum", result: "beam" },
      p("feFuncA", { type: "linear", slope: 1.5, intercept: -0.35 }),
    ),
    p("feComposite", {
      in: "beam",
      in2: "SourceAlpha",
      operator: "in",
      result: "trace",
    }),
    ...paint(tone.phosphor, "trace", "glow"),
    p("feGaussianBlur", { in: "glow", stdDeviation: 2.5, result: "bloom" }),
    ...tile("<rect y='2' width='3' height='1' fill='black'/>", 3, "scan"),
    p("feOffset", {
      in: "scan",
      dx: 0,
      dy: 0,
      result: "scanRoll",
      "data-sprite-boil": "roll",
    }),
    ...paint(tone.screen, "scanRoll", "scanlines", 0.6),
    merge("crt", "ground", "bloom", "glow", "scanlines"),
  ],
  boil: {
    intervalMs: 120,
    tracks: [{ name: "roll", attribute: "dy", frames: [0, 1, 2] }],
  },
};

/** Soft pigment bleeding into grained paper, pooling at its edges. */
const watercolor: FilterDefinition = {
  region: bleedBox,
  primitives: [
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.03,
      numOctaves: 3,
      seed: 9,
      result: "flow",
    }),
    p("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "flow",
      scale: 7,
      xChannelSelector: "R",
      yChannelSelector: "G",
      result: "bled",
    }),
    p("feGaussianBlur", { in: "bled", stdDeviation: 1.4, result: "wash" }),
    // Pigment thins toward paper white inside the wash.
    p(
      "feComponentTransfer",
      { in: "wash", result: "thin" },
      p("feFuncR", { type: "linear", slope: 0.78, intercept: 0.2 }),
      p("feFuncG", { type: "linear", slope: 0.78, intercept: 0.2 }),
      p("feFuncB", { type: "linear", slope: 0.78, intercept: 0.2 }),
      p("feFuncA", { type: "linear", slope: 0.9, intercept: 0 }),
    ),
    // Edge pooling: the rim where the wash dries darker.
    p("feGaussianBlur", { in: "wash", stdDeviation: 3, result: "spread" }),
    p("feComposite", {
      in: "wash",
      in2: "spread",
      operator: "arithmetic",
      k2: 1.6,
      k3: -1.4,
      result: "rimMask",
    }),
    p(
      "feComponentTransfer",
      { in: "wash", result: "deep" },
      p("feFuncR", { type: "linear", slope: 0.6, intercept: 0 }),
      p("feFuncG", { type: "linear", slope: 0.6, intercept: 0 }),
      p("feFuncB", { type: "linear", slope: 0.6, intercept: 0 }),
    ),
    p("feComposite", {
      in: "deep",
      in2: "rimMask",
      operator: "in",
      result: "rim",
    }),
    // Paper grain lifts pigment off the tooth.
    p("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: 0.7,
      numOctaves: 2,
      seed: 11,
      result: "tooth",
    }),
    alphaMatrix("0 0 0 -0.8 1.5", "tooth", "toothMask"),
    // Eyes and mouth stay as crisp darks.
    darkness("SourceGraphic", "dark"),
    alphaMatrix("0 0 0 5 -3.8", "dark", "keyMask"),
    ...paint(tone.ink, "keyMask", "key", 0.9),
    merge("paint", "thin", "rim", "key"),
    p("feComposite", { in: "paint", in2: "toothMask", operator: "in" }),
  ],
};

const pencilFirm = pencil(firmPressure);
const definitions = {
  manga,
  riso,
  halftone,
  blueprint,
  crt,
  watercolor,
} as const satisfies Record<
  Exclude<RenderStyle, "plain" | "pencil">,
  FilterDefinition
>;
const definitionFor = (
  style: Exclude<RenderStyle, "plain">,
): FilterDefinition => (style === "pencil" ? pencilFirm : definitions[style]);

const svgNamespace = "http://www.w3.org/2000/svg";
const build = (document: Document, primitive: Primitive): Element => {
  const element = document.createElementNS(svgNamespace, primitive.tag);
  for (const [name, value] of Object.entries(primitive.attributes))
    element.setAttribute(name, String(value));
  for (const child of primitive.children)
    element.append(build(document, child));
  return element;
};

// A per-load prefix keeps ids distinct even when two bundles each carry Sprite.

/** The filter layer owned by one mounted player. */
export type RenderStyleLayer = {
  /** Draw `stage` in `style`; `plain` removes the filter. */
  set(style: RenderStyle, stage: HTMLElement): void;
  /** Hold one still frame: paused, hidden, or reduced motion. */
  still(value: boolean): void;
  /** Stop the boil and remove the filter and its definitions. */
  dispose(): void;
};

/**
 * Mount a render-style layer in `host`. The filter applies only to the stage
 * box, and its boil runs only while the host is on screen and not still.
 */
export function createRenderStyleLayer(host: HTMLElement): RenderStyleLayer {
  const fragmentPrefix = `sprite-style-${correlationKey()}`;
  const document = host.ownerDocument;
  const view = document.defaultView;
  let style: RenderStyle = "plain";
  let stage: HTMLElement | undefined;
  let defs: SVGSVGElement | undefined;
  let still = false;
  let visible = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const run = () => {
    stop();
    if (style === "plain" || !defs || still || !visible || document.hidden)
      return;
    const boil = definitionFor(style).boil;
    if (!boil) return;
    const filter = defs;
    timer = setInterval(() => {
      if (document.hidden) return;
      frame += 1;
      for (const track of boil.tracks) {
        const value = track.frames[frame % track.frames.length];
        filter
          .querySelector(`[data-sprite-boil="${track.name}"]`)
          ?.setAttribute(track.attribute, String(value));
      }
    }, boil.intervalMs);
  };
  const Observer = view?.IntersectionObserver;
  const observer = Observer
    ? new Observer((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        run();
      })
    : undefined;
  observer?.observe(host);

  const clear = () => {
    stop();
    defs?.remove();
    defs = undefined;
    if (stage) stage.style.filter = "";
  };

  return {
    set(next, nextStage) {
      if (next === style && nextStage === stage) return;
      clear();
      style = next;
      stage = nextStage;
      if (next === "plain") return;
      const definition = definitionFor(next);
      const fragment = `${fragmentPrefix}-${next}`;
      const svg = document.createElementNS(svgNamespace, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      svg.append(
        build(
          document,
          p(
            "filter",
            {
              id: fragment,
              ...definition.region,
              "color-interpolation-filters": "sRGB",
            },
            ...definition.primitives,
          ),
        ),
      );
      host.append(svg);
      defs = svg;
      nextStage.style.filter = `url(#${fragment})`;
      run();
    },
    still(value) {
      if (value === still) return;
      still = value;
      run();
    },
    dispose() {
      clear();
      stage = undefined;
      observer?.disconnect();
    },
  };
}
