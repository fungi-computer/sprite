/**
 * Ink drawings: traced manga strokes drawn on the page, stroke by stroke, with
 * a little hand wobble. Screentone dots sprinkle in after the linework and
 * coral goes down last. Plain Canvas 2D, so there is nothing else to load.
 */

/**
 * Traced art: flat [x, y, width, ...] strokes, solid fills as solids (an outer
 * loop then its holes, each a flat [x, y, ...] list, filled even-odd), and a
 * flat [x, y, r, ...] screentone dot field.
 */
export type InkArt = Readonly<{
  width: number;
  height: number;
  ink: readonly (readonly number[])[];
  coral: readonly (readonly number[])[];
  fills?: Readonly<{
    ink: readonly InkSolid[];
    coral: readonly InkSolid[];
  }>;
  dots: readonly number[];
}>;

/** One filled solid: its outer loop first, then any holes. */
export type InkSolid = readonly (readonly number[])[];

/** Colours as CSS colour strings; the caller reads them from its theme. */
export type InkPalette = Readonly<{ ink: string; coral: string }>;

/** Options accepted by mountInkDrawing. */
export type InkDrawingOptions = Readonly<{
  art: InkArt;
  palette: () => InkPalette;
  /** Seconds for the whole drawing. Defaults to 2.5. */
  duration?: number;
  /** Wobble amplitude in art pixels. Defaults to 0.9. */
  wobble?: number;
  /** Seed for a repeatable hand. */
  seed?: number;
}>;

/** A mounted drawing. `redraw` repaints (after a theme change); `destroy` removes it. */
export type InkDrawing = Readonly<{ redraw: () => void; destroy: () => void }>;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Segment = Readonly<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  coral: boolean;
}>;

/** Every stroke broken into wobbled segments, in drawing order. */
function segmentsOf(art: InkArt, wobble: number, seed: number): Segment[] {
  const rand = random(seed);
  const out: Segment[] = [];
  const add = (stroke: readonly number[], coral: boolean) => {
    // One slow drift per stroke plus a little jitter per point reads as a hand.
    const phase = rand() * Math.PI * 2;
    const drift = wobble * (0.5 + rand());
    const points: [number, number, number][] = [];
    for (let index = 0; index + 2 < stroke.length; index += 3) {
      const step = index / 3;
      const bend = Math.sin(phase + step * 0.35) * drift;
      points.push([
        (stroke[index] ?? 0) + bend + (rand() - 0.5) * wobble * 0.4,
        (stroke[index + 1] ?? 0) + bend * 0.6 + (rand() - 0.5) * wobble * 0.4,
        (stroke[index + 2] ?? 1) * (0.85 + rand() * 0.3),
      ]);
    }
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if (!a || !b) continue;
      out.push({
        x0: a[0],
        y0: a[1],
        x1: b[0],
        y1: b[1],
        width: (a[2] + b[2]) / 2,
        coral,
      });
    }
  };
  for (const stroke of art.ink) add(stroke, false);
  const inkCount = out.length;
  for (const stroke of art.coral) add(stroke, true);
  // Ink first, then coral: the order the brief asks for.
  return [...out.slice(0, inkCount), ...out.slice(inkCount)];
}

function prefersStill(view: Window): boolean {
  return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Draw `art` into a canvas that fills `host`'s width at the art's aspect ratio.
 * Drawing starts when the host scrolls into view and pauses off screen.
 * Reduced motion paints the finished drawing at once.
 */
export function mountInkDrawing(
  host: HTMLElement,
  options: InkDrawingOptions,
): InkDrawing {
  const { art, palette, duration = 2.5, wobble = 0.9, seed = 11 } = options;
  const view = host.ownerDocument.defaultView;
  if (!view) throw new Error("Ink drawings need a browser window");
  const canvas = host.ownerDocument.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.aspectRatio = `${String(art.width)} / ${String(art.height)}`;
  host.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  const segments = segmentsOf(art, wobble, seed);
  const inkFills = art.fills?.ink ?? [];
  const coralFills = art.fills?.coral ?? [];
  const dotCount = art.dots.length / 3;
  // Share of the timeline for each pass: linework, solid ink, screentone, coral.
  const phases = { lines: 0.5, fills: 0.15, dots: 0.15 };
  let colours = palette();
  let drawnSegments = 0;
  let drawnInkSolids = 0;
  let drawnCoralSolids = 0;
  let drawnDots = 0;
  let elapsed = 0;
  let frame = 0;
  let last = 0;
  let visible = false;

  const size = () => {
    const scale = Math.min(view.devicePixelRatio || 1, 2);
    const cssWidth = host.clientWidth || art.width;
    canvas.width = Math.round(cssWidth * scale);
    canvas.height = Math.round((cssWidth * scale * art.height) / art.width);
    context.setTransform(
      canvas.width / art.width,
      0,
      0,
      canvas.height / art.height,
      0,
      0,
    );
    context.lineCap = "round";
    context.lineJoin = "round";
  };
  const drawSegments = (until: number) => {
    for (; drawnSegments < until; drawnSegments += 1) {
      const segment = segments[drawnSegments];
      if (!segment) break;
      context.strokeStyle = segment.coral ? colours.coral : colours.ink;
      context.lineWidth = segment.width;
      context.beginPath();
      context.moveTo(segment.x0, segment.y0);
      context.lineTo(segment.x1, segment.y1);
      context.stroke();
    }
  };
  const drawDots = (until: number) => {
    context.fillStyle = colours.ink;
    for (; drawnDots < until; drawnDots += 1) {
      const x = art.dots[drawnDots * 3] ?? 0;
      const y = art.dots[drawnDots * 3 + 1] ?? 0;
      const r = art.dots[drawnDots * 3 + 2] ?? 1;
      context.beginPath();
      context.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
      context.fill();
    }
  };
  // Solid areas go down one closed solid at a time, holes cut even-odd.
  const drawSolids = (
    solids: readonly InkSolid[],
    from: number,
    until: number,
    colour: string,
  ) => {
    context.fillStyle = colour;
    for (let index = from; index < until; index += 1) {
      const solid = solids[index];
      if (!solid) continue;
      context.beginPath();
      for (const loop of solid) {
        context.moveTo(loop[0] ?? 0, loop[1] ?? 0);
        for (let point = 2; point + 1 < loop.length; point += 2)
          context.lineTo(loop[point] ?? 0, loop[point + 1] ?? 0);
        context.closePath();
      }
      context.fill("evenodd");
    }
    return Math.max(from, until);
  };
  const inkSegments = segments.findIndex((segment) => segment.coral);
  const inkEnd = inkSegments === -1 ? segments.length : inkSegments;
  const share = (progress: number, start: number, length: number) =>
    Math.min(1, Math.max(0, (progress - start) / length));
  const paint = (progress: number) => {
    drawSegments(Math.floor(inkEnd * share(progress, 0, phases.lines)));
    drawnInkSolids = drawSolids(
      inkFills,
      drawnInkSolids,
      Math.floor(inkFills.length * share(progress, phases.lines, phases.fills)),
      colours.ink,
    );
    const dotsStart = phases.lines + phases.fills;
    drawDots(Math.floor(dotCount * share(progress, dotsStart, phases.dots)));
    const coralStart = dotsStart + phases.dots;
    const coral = share(progress, coralStart, 1 - coralStart);
    if (coral > 0) {
      drawSegments(inkEnd + Math.floor((segments.length - inkEnd) * coral));
      drawnCoralSolids = drawSolids(
        coralFills,
        drawnCoralSolids,
        Math.floor(coralFills.length * coral),
        colours.coral,
      );
    }
  };
  const finish = () => {
    elapsed = duration;
    paint(1);
  };
  const reset = () => {
    size();
    context.clearRect(0, 0, art.width, art.height);
    drawnSegments = 0;
    drawnInkSolids = 0;
    drawnCoralSolids = 0;
    drawnDots = 0;
  };

  const tick = (now: number) => {
    frame = 0;
    if (!visible) return;
    elapsed += Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    paint(Math.min(1, elapsed / duration));
    if (elapsed < duration) frame = view.requestAnimationFrame(tick);
  };
  const play = () => {
    if (frame || elapsed >= duration) return;
    last = 0;
    frame = view.requestAnimationFrame(tick);
  };

  reset();
  if (prefersStill(view)) finish();
  const observer = new view.IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) play();
      else if (frame) {
        view.cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    { threshold: 0.2 },
  );
  observer.observe(host);

  const redraw = () => {
    colours = palette();
    reset();
    paint(Math.min(1, elapsed / duration));
  };
  let lastWidth = host.clientWidth;
  const resized = new view.ResizeObserver(() => {
    if (host.clientWidth === lastWidth) return;
    lastWidth = host.clientWidth;
    redraw();
  });
  resized.observe(host);

  return {
    redraw,
    destroy: () => {
      observer.disconnect();
      resized.disconnect();
      if (frame) view.cancelAnimationFrame(frame);
      canvas.remove();
    },
  };
}
