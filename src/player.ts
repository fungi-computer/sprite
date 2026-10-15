import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as z from "zod";

import { createAssetReader, type AssetPolicy } from "./assets.js";
import { resolveAppearance, type Appearance } from "./controls.js";
import {
  createRenderStyleLayer,
  renderStyleSchema,
  type RenderStyle,
} from "./render-style.js";
import {
  characterSchema,
  localCharacterSourceSchema,
  type CharacterDocument,
  type CharacterSource,
} from "./document.js";

/** One complete request. Omitted customization resets to character defaults. */
export type AvatarPresentation = {
  readonly src: CharacterSource;
  readonly activity?: string;
  readonly expression?: string;
  readonly appearance?: Appearance;
  /** SVG filter drawn over the character; omitted draws it plain. */
  readonly renderStyle?: RenderStyle;
};

/** The resolved activity and appearance passed to a native renderer. */
export type NativePresentation = {
  readonly activity: string;
  readonly expression: string | null;
  readonly appearance: Appearance;
};

/** The adapter registers native destruction in the selection scope. */
export type NativePlayer = {
  readonly activities: readonly string[];
  readonly expressions: readonly string[];
  /** Update the existing native instance. */
  set(presentation: NativePresentation): void;
  /** Pause or resume animation without losing the current frame. */
  pause(paused: boolean): void;
};

/** Native renderer access to the selected document and its admitted assets. */
export type RendererContext = {
  readonly target: HTMLElement;
  readonly document: CharacterDocument;
  readonly signal: AbortSignal;
  readonly maxPixels: number;
  /** Report a native failure that occurs after the renderer has become ready. */
  readonly reportError: (error: Error) => void;
  /** Admit an asset and revoke its object URL when the selection closes. */
  readonly assetURL: (
    reference: string,
  ) => Effect.Effect<string, Error, Scope.Scope>;
};

/** A native renderer whose resources live in the character selection scope. */
export type Renderer = (
  context: RendererContext,
) => Effect.Effect<NativePlayer, Error, Scope.Scope>;

/** A request after native fallback and appearance validation. */
export type EffectivePresentation = NativePresentation & {
  readonly renderStyle: RenderStyle;
  readonly requestedActivity: string;
  readonly requestedExpression: string | null;
  readonly fallback: boolean;
};

/** Observable loading, ready, error, and disposal states. */
export type PlayerState =
  | { readonly status: "empty" | "loading" | "destroyed" }
  | { readonly status: "error"; readonly error: Error }
  | {
      readonly status: "ready";
      readonly document: CharacterDocument;
      readonly presentation: EffectivePresentation;
      readonly updateError?: Error;
    };

/** An installed document and its renderer, loaded together by the shell. */
export type LocalCharacter = {
  readonly document: CharacterDocument;
  readonly render: Renderer;
};
/** Host-owned character registry and resource policy. */
export type SpriteOptions = {
  /** Omit for local-only characters; network access is denied by default. */
  readonly assets?: AssetPolicy;
  readonly maxPixels?: number;
  /** Native adapters allowed for served character documents. */
  readonly renderers?: Readonly<
    Record<string, () => Promise<{ default: Renderer }>>
  >;
  /** Lazy local characters installed by this shell. */
  readonly characters?: Readonly<Record<string, () => Promise<LocalCharacter>>>;
};

/** One mounted avatar; dispose releases its native and browser resources. */
export type AvatarPlayer = {
  /** Current public state. */
  readonly state: PlayerState;
  /** Observe state changes until the returned unsubscribe function is called. */
  subscribe(listener: (next: PlayerState) => void): () => void;
  /** Select a source or update its activity and appearance. */
  set(next: AvatarPresentation): void;
  /** Pause or resume the current native animation. */
  pause(value: boolean): void;
  /** Cancel loading and release the current native selection. */
  dispose(): Promise<void>;
};

/** Stable shell configuration that creates independent mounted players. */
export type SpriteService = {
  /** Claim one DOM host for a new avatar instance. */
  mount(target: HTMLElement): AvatarPlayer;
};

type Selection = {
  readonly key: string;
  readonly scope: Scope.Closeable;
  readonly controller: AbortController;
  readonly holder: HTMLDivElement;
  native?: NativePlayer;
  document?: CharacterDocument;
  appliedKey?: string;
};

type ResolvedSource =
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "local"; readonly key: string };

const resolveSource = (
  source: CharacterSource,
  baseURL: string,
): ResolvedSource => {
  const local = localCharacterSourceSchema.safeParse(source);
  if (local.success) return { kind: "local", key: local.data.local };
  return {
    kind: "remote",
    url: new URL(z.string().parse(source), baseURL).href,
  };
};

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause), { cause });
const exitError = (exit: Exit.Exit<unknown, unknown>): Error =>
  Exit.isFailure(exit)
    ? asError(Cause.squash(exit.cause))
    : new Error("Unexpected Sprite success");
type CleanupOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "failed"; readonly error: Error };

/** Stable shell service; each mounted player owns its own selection. */
export function createSprite(options: SpriteOptions): SpriteService {
  const maxPixels = options.maxPixels ?? 4_194_304;
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0)
    throw new Error("Sprite pixel limit must be a positive safe integer");
  const assetPolicy: AssetPolicy = options.assets ?? {
    baseURL: "https://sprite.invalid/",
    allowedOrigins: [],
    maxBytes: 1,
    maxTotalBytes: 1,
    maxRequests: 1,
  };
  const newAssetReader = createAssetReader(assetPolicy);
  const owners = new WeakSet<HTMLElement>();
  const priorCleanup = new WeakMap<HTMLElement, Promise<CleanupOutcome>>();
  const sourceKey = (source: CharacterSource) => {
    const resolved = resolveSource(source, assetPolicy.baseURL);
    return resolved.kind === "remote" ? resolved.url : `local:${resolved.key}`;
  };

  return {
    mount(target: HTMLElement) {
      if (owners.has(target))
        throw new Error("A Sprite already owns this target");
      owners.add(target);
      const mountScope = Effect.runSync(Scope.make());
      const listeners = new Set<(state: PlayerState) => void>();
      let state: PlayerState = { status: "empty" };
      let desired: AvatarPresentation | undefined;
      let selection: Selection | undefined;
      let revision = 0;
      let dirty = false;
      let worker: Promise<void> | undefined;
      let retiring: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      let disposed = false;
      let paused = false;
      const view = target.ownerDocument.defaultView;
      const motion = view?.matchMedia("(prefers-reduced-motion: reduce)");

      const publish = (next: PlayerState) => {
        if (disposed && next.status !== "destroyed") return;
        state = next;
        for (const listener of listeners) {
          try {
            listener(next);
          } catch (error) {
            console.error("Sprite state observer failed", error);
          }
        }
      };
      const failSelection = (error: Error) => {
        selection?.controller.abort();
        selection?.holder.remove();
        publish({ status: "error", error });
        void closeSelection().catch((cleanupError: unknown) => {
          publish({
            status: "error",
            error: new AggregateError(
              [error, cleanupError],
              "Avatar failed and cleanup also failed",
            ),
          });
        });
      };
      const styles = createRenderStyleLayer(target);
      const suspend = () => {
        const still =
          paused || target.ownerDocument.hidden || motion?.matches === true;
        styles.still(still);
        try {
          selection?.native?.pause(still);
        } catch (error) {
          failSelection(asError(error));
        }
      };
      Effect.runSync(
        Scope.addFinalizer(
          mountScope,
          Effect.sync(() => {
            target.ownerDocument.removeEventListener(
              "visibilitychange",
              suspend,
            );
            motion?.removeEventListener("change", suspend);
            styles.dispose();
          }),
        ),
      );
      target.ownerDocument.addEventListener("visibilitychange", suspend);
      motion?.addEventListener("change", suspend);

      const closeSelection = async () => {
        if (retiring) return retiring;
        const old = selection;
        if (!old) return;
        selection = undefined;
        old.controller.abort();
        old.holder.remove();
        const cleanup = Effect.runPromiseExit(
          Scope.close(old.scope, Exit.void),
        ).then((exit) => {
          if (Exit.isFailure(exit)) throw exitError(exit);
        });
        retiring = cleanup;
        try {
          await cleanup;
        } finally {
          if (retiring === cleanup) retiring = undefined;
        }
      };

      const apply = (current: Selection) => {
        const native = current.native;
        const document = current.document;
        const request = desired;
        if (!native || !document || !request || selection !== current) return;
        const activity = request.activity ?? "idle";
        const expression = request.expression ?? native.expressions[0] ?? null;
        let appearance: Appearance;
        let renderStyle: RenderStyle;
        try {
          appearance = resolveAppearance(document.controls, request.appearance);
          renderStyle = renderStyleSchema.parse(request.renderStyle ?? "plain");
        } catch (error) {
          const updateError = asError(error);
          if (state.status === "ready") {
            if (state.updateError?.message !== updateError.message)
              publish({ ...state, updateError });
          } else failSelection(updateError);
          return;
        }
        const effective: EffectivePresentation = {
          requestedActivity: activity,
          requestedExpression: expression,
          activity: native.activities.includes(activity) ? activity : "idle",
          expression:
            expression !== null && native.expressions.includes(expression)
              ? expression
              : (native.expressions[0] ?? null),
          appearance,
          renderStyle,
          fallback:
            !native.activities.includes(activity) ||
            (expression !== null && !native.expressions.includes(expression)),
        };
        const key = JSON.stringify([
          effective.activity,
          effective.expression,
          effective.appearance,
        ]);
        styles.set(renderStyle, current.holder);
        if (
          key === current.appliedKey &&
          state.status === "ready" &&
          state.presentation.renderStyle === renderStyle &&
          state.updateError === undefined &&
          state.presentation.requestedActivity === activity &&
          state.presentation.requestedExpression === expression
        )
          return;
        try {
          if (key !== current.appliedKey) native.set(effective);
          current.appliedKey = key;
          suspend();
          if (selection === current)
            publish({ status: "ready", document, presentation: effective });
        } catch (error) {
          failSelection(asError(error));
        }
      };

      const openSelection = async (
        request: AvatarPresentation,
        key: string,
        token: number,
      ) => {
        const readAsset = newAssetReader();
        const scope = Effect.runSync(Scope.make());
        const controller = new AbortController();
        const holder = target.ownerDocument.createElement("div");
        holder.style.cssText = "width:100%;height:100%;position:relative";
        const current: Selection = { key, scope, controller, holder };
        selection = current;
        Effect.runSync(
          Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              holder.remove();
            }),
          ),
        );
        // Canvas engines need a real layout box before native initialization.
        target.append(holder);
        const program = Effect.gen(function* () {
          let document: CharacterDocument;
          let render: Renderer;
          let base = assetPolicy.baseURL;
          const source = resolveSource(request.src, assetPolicy.baseURL);
          if (source.kind === "remote") {
            const asset = yield* Effect.tryPromise({
              try: () => readAsset(source.url, controller.signal),
              catch: asError,
            });
            base = asset.url;
            document = characterSchema.parse(
              JSON.parse(new TextDecoder().decode(asset.bytes)),
            );
            const loader =
              options.renderers &&
              Object.hasOwn(options.renderers, document.renderer)
                ? options.renderers[document.renderer]
                : undefined;
            if (!loader)
              throw new Error(
                `Renderer is not installed: ${document.renderer}`,
              );
            render = (yield* Effect.tryPromise({ try: loader, catch: asError }))
              .default;
          } else {
            const local = source.key;
            const loader =
              options.characters && Object.hasOwn(options.characters, local)
                ? options.characters[local]
                : undefined;
            if (!loader)
              throw new Error(`Character is not installed: ${local}`);
            const character = yield* Effect.tryPromise({
              try: loader,
              catch: asError,
            });
            document = characterSchema.parse(character.document);
            render = character.render;
          }
          controller.signal.throwIfAborted();
          const assetURL = (reference: string) =>
            Effect.gen(function* () {
              const asset = yield* Effect.tryPromise({
                try: () => readAsset(reference, controller.signal, base),
                catch: asError,
              });
              return yield* Effect.acquireRelease(
                Effect.sync(() =>
                  URL.createObjectURL(
                    new Blob([asset.bytes], { type: asset.contentType }),
                  ),
                ),
                (url) =>
                  Effect.sync(() => {
                    URL.revokeObjectURL(url);
                  }),
              );
            });
          const native = yield* render({
            target: holder,
            document,
            signal: controller.signal,
            maxPixels,
            reportError: (error) => {
              if (selection === current && !controller.signal.aborted)
                failSelection(error);
            },
            assetURL,
          });
          if (!native.activities.includes("idle"))
            throw new Error("Character has no idle fallback");
          native.pause(true);
          return { native, document };
        }).pipe(Scope.provide(scope));
        const exit = await Effect.runPromiseExit(program, {
          signal: controller.signal,
        });
        if (disposed || token !== revision || selection !== current) {
          return;
        }
        if (Exit.isFailure(exit)) {
          const error = exitError(exit);
          try {
            await closeSelection();
            publish({ status: "error", error });
          } catch (cleanupError) {
            publish({
              status: "error",
              error: new AggregateError(
                [error, cleanupError],
                "Avatar load and cleanup failed",
              ),
            });
          }
          return;
        }
        current.native = exit.value.native;
        current.document = exit.value.document;
        apply(current);
      };

      const reconcile = async () => {
        const superseded = (token: number) => disposed || token !== revision;
        while (dirty && !disposed) {
          dirty = false;
          const token = revision;
          await closeSelection();
          if (superseded(token) || !desired) continue;
          const prior = await priorCleanup.get(target);
          if (prior?.kind === "failed") throw prior.error;
          if (superseded(token)) continue;
          publish({ status: "loading" });
          await openSelection(desired, sourceKey(desired.src), token);
        }
      };
      const schedule = () => {
        dirty = true;
        selection?.controller.abort();
        selection?.holder.remove();
        if (worker) return;
        worker = reconcile()
          .catch((error: unknown) => {
            publish({ status: "error", error: asError(error) });
          })
          .finally(() => {
            worker = undefined;
            if (dirty && !disposed) schedule();
          });
      };

      return {
        get state() {
          return state;
        },
        subscribe(listener: (next: PlayerState) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set(next: AvatarPresentation) {
          if (disposed) throw new Error("Sprite is destroyed");
          desired = next;
          const key = sourceKey(next.src);
          if (selection?.key === key && state.status === "ready")
            apply(selection);
          else if (selection?.key !== key || state.status === "error") {
            revision += 1;
            schedule();
          }
        },
        pause(value: boolean) {
          if (disposed) throw new Error("Sprite is destroyed");
          paused = value;
          suspend();
        },
        dispose(): Promise<void> {
          if (closing) return closing;
          disposed = true;
          revision += 1;
          owners.delete(target);
          selection?.controller.abort();
          selection?.holder.remove();
          publish({ status: "destroyed" });
          closing = (async () => {
            await worker;
            await closeSelection();
            const exit = await Effect.runPromiseExit(
              Scope.close(mountScope, Exit.void),
            );
            if (Exit.isFailure(exit)) throw exitError(exit);
          })();
          priorCleanup.set(
            target,
            closing.then(
              () => ({ kind: "closed" }),
              (cause: unknown) => ({
                kind: "failed",
                error: asError(cause),
              }),
            ),
          );
          return closing;
        },
      };
    },
  };
}
