/**
 * A living mycelium field: hyphae grow slowly across a host element and coral
 * nodes pulse when something finishes. Rendered with Pixi 8, which the host
 * loads lazily and passes in, so Sprite itself never bundles Pixi.
 */

/** The slice of Pixi 8's Graphics this field draws with. */
export type PixiGraphics = {
  moveTo(x: number, y: number): PixiGraphics;
  lineTo(x: number, y: number): PixiGraphics;
  stroke(style: {
    width: number;
    color: string;
    alpha: number;
    cap: "round";
  }): PixiGraphics;
  circle(x: number, y: number, radius: number): PixiGraphics;
  fill(style: { color: string }): PixiGraphics;
  clear(): PixiGraphics;
  position: { set(x: number, y: number): void };
  scale: { set(value: number): void };
  alpha: number;
  destroy(): void;
};
/** A Pixi render texture this field bakes threads into. */
export type PixiTexture = { destroy(destroySource?: boolean): void };
/** The slice of Pixi 8's Application this field drives. */
export type PixiApplication<Texture extends PixiTexture = PixiTexture> = {
  init(options: {
    resizeTo: HTMLElement;
    backgroundAlpha: number;
    antialias: boolean;
    autoDensity: boolean;
    resolution: number;
    preference: "webgl";
  }): Promise<void>;
  canvas: HTMLCanvasElement;
  screen: { width: number; height: number };
  renderer: {
    resolution: number;
    render(options: {
      container: PixiGraphics;
      target: Texture;
      clear: boolean;
    }): void;
  };
  stage: { addChild(...children: unknown[]): void };
  ticker: {
    deltaMS: number;
    add(listener: () => void): void;
    start(): void;
    stop(): void;
  };
  render(): void;
  destroy(
    rendererOptions: { removeView: boolean },
    options: { children: boolean },
  ): void;
};
/** The Pixi 8 module surface this field needs; pass `await import("pixi.js")`. */
export type PixiModule<Texture extends PixiTexture = PixiTexture> = {
  Application: new () => PixiApplication<Texture>;
  Container: new () => { addChild(...children: unknown[]): void };
  Graphics: new () => PixiGraphics;
  Sprite: new (texture: Texture) => { texture: Texture };
  RenderTexture: {
    create(options: {
      width: number;
      height: number;
      resolution: number;
    }): Texture;
  };
};

/** Colors as CSS color strings; the caller reads them from its theme. */
export type MyceliumPalette = Readonly<{
  thread: string;
  node: string;
}>;

/** Options accepted by mountMycelium. */
export type MyceliumOptions<Texture extends PixiTexture = PixiTexture> =
  Readonly<{
    /** The Pixi 8 module, loaded by the host. */
    pixi: PixiModule<Texture>;
    palette: MyceliumPalette;
    /** Seed for a repeatable network. */
    seed?: number;
    /** Segment budget before growth rests. Defaults to 2600. */
    segments?: number;
    /** Thread opacity, 0 to 1. Defaults to 0.22 so text above stays readable. */
    threadAlpha?: number;
    /** Mean seconds between automatic node pulses. Defaults to 2.4. */
    pulseEvery?: number;
    /** Starting thread width in CSS pixels. Defaults to 1.6. */
    threadWidth?: number;
    /**
     * Rectangles, in host coordinates, that threads never enter (for example
     * a headline's line boxes). Read again on every restart.
     */
    avoid?: () => readonly MyceliumRect[];
    /**
     * A focal rectangle, in host coordinates. Growth starts along its edges so
     * the network is densest around it. Defaults to the host's bottom and sides.
     */
    focus?: () => MyceliumRect | null;
  }>;

/** A rectangle in the host's coordinate space. */
export type MyceliumRect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

/** A mounted field. `pulse` lights one node; `destroy` removes everything. */
export type MyceliumField = Readonly<{
  pulse: () => void;
  destroy: () => void;
}>;

type Tip = { x: number; y: number; angle: number; life: number; width: number };
type Node = { x: number; y: number; glow: number; sprite: PixiGraphics };

/** A small, fast, seeded PRNG (mulberry32). */
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

function prefersStill(view: Window): boolean {
  return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Mount a mycelium field that fills `host`. Reduced motion renders one
 * composed, fully grown frame and never ticks. The ticker pauses while the host
 * is off screen or the document is hidden.
 */
export async function mountMycelium<Texture extends PixiTexture>(
  host: HTMLElement,
  options: MyceliumOptions<Texture>,
): Promise<MyceliumField> {
  const {
    pixi,
    palette,
    seed = 7,
    segments = 2600,
    threadAlpha = 0.22,
    pulseEvery = 2.4,
    threadWidth = 1.6,
    avoid = () => [],
    focus = () => null,
  } = options;
  const view = host.ownerDocument.defaultView;
  if (!view) throw new Error("Mycelium needs a browser window");
  const app = new pixi.Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(view.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  const canvas = app.canvas;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.append(canvas);

  const rand = random(seed);
  const still = prefersStill(view);
  const nodes: Node[] = [];
  const nodeLayer = new pixi.Container();
  const pen = new pixi.Graphics();
  let baked = pixi.RenderTexture.create({
    width: app.screen.width,
    height: app.screen.height,
    resolution: app.renderer.resolution,
  });
  const canvasSprite = new pixi.Sprite(baked);
  app.stage.addChild(canvasSprite, nodeLayer);

  let tips: Tip[] = [];
  let drawn = 0;
  const addNode = (x: number, y: number) => {
    const dot = new pixi.Graphics()
      .circle(0, 0, 2.6 + rand() * 2)
      .fill({ color: palette.node });
    dot.position.set(x, y);
    dot.alpha = 0.55;
    nodeLayer.addChild(dot);
    nodes.push({ x, y, glow: 0, sprite: dot });
  };
  let blocked: readonly MyceliumRect[] = [];
  const isBlocked = (x: number, y: number) =>
    blocked.some(
      (rect) =>
        x > rect.left && x < rect.right && y > rect.top && y < rect.bottom,
    );
  const seedTips = () => {
    const { width, height } = app.screen;
    blocked = avoid();
    tips = [];
    const start = (x: number, y: number, angle: number, life: number) => {
      tips.push({ x, y, angle, life, width: threadWidth });
      addNode(x, y);
    };
    const target = focus();
    if (target) {
      // Densest around the focus: threads leave its edges and wrap around it.
      // Growth lives in the gutters and below the focus: threads leave its
      // left and right edges and its bottom, never its top.
      const count = Math.max(10, Math.round(width / 90));
      for (let index = 0; index < count; index += 1) {
        const side = rand();
        const along = rand();
        if (side < 0.4)
          start(
            target.left - 6,
            target.top + along * (target.bottom - target.top),
            Math.PI + (rand() - 0.5) * 1.4,
            110 + rand() * 180,
          );
        else if (side < 0.8)
          start(
            target.right + 6,
            target.top + along * (target.bottom - target.top),
            (rand() - 0.5) * 1.4,
            110 + rand() * 180,
          );
        else
          start(
            target.left + along * (target.right - target.left),
            target.bottom + 6,
            Math.PI / 2 + (rand() - 0.5) * 1.2,
            60 + rand() * 110,
          );
      }
      return;
    }
    const count = Math.max(4, Math.round(width / 220));
    for (let index = 0; index < count; index += 1) {
      const fromBottom = rand() < 0.6;
      const x = fromBottom ? rand() * width : rand() < 0.5 ? 0 : width;
      const y = fromBottom ? height : height * (0.35 + rand() * 0.65);
      const angle = fromBottom
        ? -Math.PI / 2 + (rand() - 0.5) * 1.1
        : x === 0
          ? -0.4 + (rand() - 0.5) * 0.8
          : Math.PI + 0.4 + (rand() - 0.5) * 0.8;
      start(x, y, angle, 120 + rand() * 220);
    }
  };
  const grow = (steps: number) => {
    const { width, height } = app.screen;
    for (let step = 0; step < steps && drawn < segments; step += 1) {
      const next: Tip[] = [];
      for (const tip of tips) {
        const length = 3 + rand() * 4;
        const angle = tip.angle + (rand() - 0.5) * 0.5;
        const x = tip.x + Math.cos(angle) * length;
        const y = tip.y + Math.sin(angle) * length;
        if (isBlocked(x, y)) continue;
        pen.moveTo(tip.x, tip.y).lineTo(x, y).stroke({
          width: tip.width,
          color: palette.thread,
          alpha: threadAlpha,
          cap: "round",
        });
        drawn += 1;
        const life = tip.life - 1;
        const inside = x > -20 && x < width + 20 && y > -20 && y < height + 20;
        if (!inside || life <= 0) continue;
        next.push({
          x,
          y,
          angle,
          life,
          width: Math.max(0.5, tip.width * 0.998),
        });
        if (rand() < 0.035 && next.length < 90) {
          const branch = angle + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6);
          next.push({
            x,
            y,
            angle: branch,
            life: life * (0.5 + rand() * 0.4),
            width: tip.width * 0.72,
          });
          if (rand() < 0.45) addNode(x, y);
        }
      }
      tips = next;
      if (tips.length === 0) break;
    }
    app.renderer.render({ container: pen, target: baked, clear: false });
    pen.clear();
  };

  const pulse = () => {
    const node = nodes[Math.floor(rand() * nodes.length)];
    if (node) node.glow = 1;
  };

  const restart = () => {
    baked.destroy(true);
    baked = pixi.RenderTexture.create({
      width: app.screen.width,
      height: app.screen.height,
      resolution: app.renderer.resolution,
    });
    canvasSprite.texture = baked;
    for (const node of nodes) node.sprite.destroy();
    nodes.length = 0;
    drawn = 0;
    seedTips();
    if (still) {
      grow(segments);
      app.render();
    }
  };

  let untilPulse = pulseEvery;
  const tick = () => {
    const seconds = app.ticker.deltaMS / 1000;
    if (drawn < segments && tips.length > 0) grow(4);
    untilPulse -= seconds;
    if (untilPulse <= 0) {
      pulse();
      untilPulse = pulseEvery * (0.5 + rand());
    }
    for (const node of nodes) {
      if (node.glow <= 0) continue;
      node.glow = Math.max(0, node.glow - seconds * 0.8);
      node.sprite.alpha = 0.55 + node.glow * 0.45;
      node.sprite.scale.set(1 + node.glow * 2.2);
    }
  };

  seedTips();
  if (still) {
    app.ticker.stop();
    grow(segments);
    app.render();
  } else {
    app.ticker.add(tick);
  }

  let visible = true;
  const sync = () => {
    if (still) return;
    if (visible && !host.ownerDocument.hidden) app.ticker.start();
    else app.ticker.stop();
  };
  const observer = new view.IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    sync();
  });
  observer.observe(host);
  host.ownerDocument.addEventListener("visibilitychange", sync);

  let lastWidth = app.screen.width;
  const resized = new view.ResizeObserver(() => {
    if (Math.abs(app.screen.width - lastWidth) < 80) return;
    lastWidth = app.screen.width;
    restart();
  });
  resized.observe(host);

  return {
    pulse,
    destroy: () => {
      observer.disconnect();
      resized.disconnect();
      host.ownerDocument.removeEventListener("visibilitychange", sync);
      baked.destroy(true);
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
