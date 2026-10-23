// @vitest-environment jsdom
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { afterEach, describe, expect, it, vi } from "vitest";

import { characterSchema } from "./document.js";
import type { RendererContext } from "./player.js";
import renderVideo from "./video.js";

afterEach(() => vi.restoreAllMocks());

const open = (maxPixels = 2_000_000) => {
  const target = document.createElement("div");
  const controller = new AbortController();
  const reportError = vi.fn<(error: Error) => void>();
  const scope = Effect.runSync(Scope.make());
  const context: RendererContext = {
    target,
    document: characterSchema.parse({
      version: 1,
      name: "Muse sample",
      renderer: "video",
      data: {
        clips: {
          idle: "portrait.mp4",
          thinking: "working.mp4",
          speaking: "portrait.mp4",
        },
      },
      poster: "mushroom.png",
    }),
    signal: controller.signal,
    maxPixels,
    reportError,
    reportProgress: vi.fn(),
    assetURL: (reference) => Effect.succeed(`blob:${reference}`),
  };
  const pending = Effect.runPromise(
    renderVideo(context).pipe(Scope.provide(scope)),
  );
  return { target, controller, scope, reportError, pending };
};

const finishTwoClips = async (opened: ReturnType<typeof open>) => {
  await vi.waitFor(() => {
    expect(opened.target.querySelectorAll("video")).toHaveLength(1);
  });
  const idle = opened.target.querySelector("video");
  idle?.dispatchEvent(new Event("loadeddata"));
  await vi.waitFor(() => {
    expect(opened.target.querySelectorAll("video")).toHaveLength(2);
  });
  const working = opened.target.querySelectorAll("video")[1];
  working?.dispatchEvent(new Event("loadeddata"));
  return { idle, working, native: await opened.pending };
};

describe("native video avatar", () => {
  it("shows an admitted first frame, pauses/resumes, and releases media", async () => {
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
      720,
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
      720,
    );
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const opened = open();
    const { idle, working, native } = await finishTwoClips(opened);
    expect(idle?.muted).toBe(true);
    expect(idle?.loop).toBe(true);
    expect(idle?.playsInline).toBe(true);
    expect(idle?.poster).toContain("blob:mushroom.png");
    expect(opened.target.querySelector("video")).toBe(idle);
    expect(native.activities).toEqual(["idle", "thinking", "speaking"]);
    native.pause(false);
    expect(play).toHaveBeenCalledOnce();
    native.set({ activity: "thinking", expression: null, appearance: {} });
    expect(opened.target.querySelector("video")).toBe(working);
    expect(play).toHaveBeenCalledTimes(2);
    native.pause(true);
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(2);
    await Effect.runPromise(Scope.close(opened.scope, Exit.void));
    expect(opened.target.querySelector("video")).toBeNull();
    expect(idle?.hasAttribute("src")).toBe(false);
    expect(working?.hasAttribute("src")).toBe(false);
  });

  it("rejects an oversized decoded frame and closes its media element", async () => {
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
      720,
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
      720,
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );
    const { target, scope, pending } = open(100);
    await vi.waitFor(() => {
      expect(target.querySelector("video")).not.toBeNull();
    });
    target.querySelector("video")?.dispatchEvent(new Event("loadeddata"));
    await expect(pending).rejects.toThrow("pixel limit");
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(target.querySelector("video")).toBeNull();
  });

  it("reports a browser playback rejection without leaving an unhandled promise", async () => {
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
      720,
    );
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
      720,
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("play blocked"),
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
      () => undefined,
    );
    const opened = open();
    const { native } = await finishTwoClips(opened);
    native.pause(false);
    await vi.waitFor(() => {
      expect(opened.reportError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });
    await Effect.runPromise(Scope.close(opened.scope, Exit.void));
  });
});
