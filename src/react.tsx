import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { HTMLAttributes, ReactNode } from "react";
import type {
  AvatarPlayer,
  AvatarPresentation,
  PlayerState,
  SpriteService,
} from "./player.js";

/** Renderer-neutral React presentation. The configured service belongs to the shell. */
const SpriteContext = createContext<SpriteService | null>(null);

/** Shell-owned renderer and asset configuration; no selected identity lives here. */
export function SpriteProvider({
  service,
  children,
}: {
  readonly service: SpriteService;
  readonly children: ReactNode;
}) {
  return (
    <SpriteContext.Provider value={service}>{children}</SpriteContext.Provider>
  );
}

/** Avatar presentation plus ordinary attributes for the DOM host. */
export type SpriteProps = AvatarPresentation &
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    /** Optional for standalone use; a shell normally supplies SpriteProvider. */
    readonly service?: SpriteService;
    readonly paused?: boolean;
    /** Observe loading, ready, error, and disposal changes. */
    readonly onState?: (state: PlayerState) => void;
  };

/** Own one player; source and appearance changes do not remount its React host. */
export const Sprite = forwardRef<HTMLDivElement, SpriteProps>(function Sprite(
  {
    service,
    src,
    activity,
    expression,
    appearance,
    renderStyle,
    paused = false,
    onState,
    ...props
  },
  forwardedRef,
) {
  const configured = useContext(SpriteContext);
  const runtime = service ?? configured;
  if (!runtime)
    throw new Error("Sprite needs a configured SpriteProvider or service");
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<AvatarPlayer | null>(null);
  const notify = useRef(onState);
  notify.current = onState;
  useImperativeHandle(forwardedRef, () => {
    if (!host.current) throw new Error("Sprite host is not mounted");
    return host.current;
  });
  useEffect(() => {
    if (!host.current) return;
    const mounted = runtime.mount(host.current);
    const unsubscribe = mounted.subscribe((state) => {
      if (host.current) host.current.dataset.spriteStatus = state.status;
      notify.current?.(state);
    });
    player.current = mounted;
    return () => {
      unsubscribe();
      void mounted.dispose().catch((error: unknown) => {
        console.error("Sprite cleanup failed", error);
      });
      player.current = null;
    };
  }, [runtime]);
  useEffect(() => {
    const mounted = player.current;
    if (!mounted) return;
    let presentation: AvatarPresentation = { src };
    if (activity !== undefined) presentation = { ...presentation, activity };
    if (expression !== undefined)
      presentation = { ...presentation, expression };
    if (appearance !== undefined)
      presentation = { ...presentation, appearance };
    if (renderStyle !== undefined)
      presentation = { ...presentation, renderStyle };
    mounted.set(presentation);
  }, [runtime, src, activity, expression, appearance, renderStyle]);
  useEffect(() => {
    player.current?.pause(paused);
  }, [runtime, paused]);
  return <div {...props} ref={host} />;
});
