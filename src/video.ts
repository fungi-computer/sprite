import { z } from "zod";
import * as Effect from "effect/Effect";
import type { Renderer } from "./player.js";

const videoSchema = z
  .strictObject({
    clips: z.record(z.string().min(1), z.string().min(1)),
  })
  .refine((data) => Object.hasOwn(data.clips, "idle"), {
    message: "Video avatar needs an idle clip",
  });

const awaitFirstFrame = (video: HTMLVideoElement, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Avatar video could not be decoded"));
    };
    const aborted = () => {
      cleanup();
      reject(new Error("Avatar video load was cancelled"));
    };
    video.addEventListener("loadeddata", loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });

/** One character, with browser-native MP4 clips selected by semantic activity. */
const renderVideo: Renderer = (context) =>
  Effect.gen(function* () {
    const data = videoSchema.parse(context.document.data);
    const posterURL = context.document.poster
      ? yield* context.assetURL(context.document.poster)
      : undefined;
    if (posterURL) {
      const poster = yield* Effect.acquireRelease(
        Effect.sync(() => context.target.ownerDocument.createElement("img")),
        (image) =>
          Effect.sync(() => {
            image.remove();
          }),
      );
      poster.alt = "";
      poster.src = posterURL;
      poster.style.cssText =
        "width:100%;height:100%;object-fit:contain;display:block";
      context.target.replaceChildren(poster);
    }

    const videos = new Map<string, HTMLVideoElement>();
    let decodedPixels = 0;
    for (const reference of new Set(Object.values(data.clips))) {
      const src = yield* context.assetURL(reference);
      const video = yield* Effect.acquireRelease(
        Effect.sync(() => context.target.ownerDocument.createElement("video")),
        (element) =>
          Effect.sync(() => {
            element.pause();
            element.removeAttribute("src");
            element.removeAttribute("poster");
            element.remove();
          }),
      );
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.style.cssText =
        "width:100%;height:100%;object-fit:contain;display:none";
      if (posterURL) video.poster = posterURL;
      context.target.append(video);
      const frame = awaitFirstFrame(video, context.signal);
      video.src = src;
      yield* Effect.tryPromise({
        try: () => frame,
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
      context.signal.throwIfAborted();
      decodedPixels += video.videoWidth * video.videoHeight;
      if (
        video.videoWidth <= 0 ||
        video.videoHeight <= 0 ||
        decodedPixels > context.maxPixels
      )
        throw new Error(
          "Avatar videos exceed the pixel limit or have no frame",
        );
      videos.set(reference, video);
    }

    const idleReference = data.clips.idle;
    const idle = idleReference ? videos.get(idleReference) : undefined;
    if (!idle) throw new Error("Video avatar has no decoded idle clip");
    let current = idle;
    let paused = true;
    const play = (video: HTMLVideoElement) => {
      void video.play().then(
        () => {
          if (paused || current !== video) video.pause();
        },
        (error: unknown) => {
          if (!paused && current === video && !context.signal.aborted)
            context.reportError(
              error instanceof Error ? error : new Error(String(error)),
            );
        },
      );
    };
    for (const video of videos.values()) {
      const failed = () => {
        if (current === video)
          context.reportError(new Error("Avatar video playback failed"));
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          video.addEventListener("error", failed);
        }),
        () =>
          Effect.sync(() => {
            video.removeEventListener("error", failed);
          }),
      );
    }
    idle.style.display = "block";
    context.target.replaceChildren(idle);
    return {
      activities: Object.keys(data.clips),
      expressions: [],
      set(presentation) {
        const reference = data.clips[presentation.activity];
        const next = reference ? videos.get(reference) : undefined;
        if (!next)
          throw new Error(`Unknown video activity: ${presentation.activity}`);
        if (next === current) return;
        current.pause();
        current.style.display = "none";
        current = next;
        current.style.display = "block";
        context.target.replaceChildren(current);
        if (!paused) play(current);
      },
      pause(value) {
        if (paused === value) return;
        paused = value;
        if (value) current.pause();
        else play(current);
      },
    };
  });

export default renderVideo;
