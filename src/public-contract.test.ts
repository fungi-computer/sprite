// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { characterSchema, createSprite } from "./index.js";
import { Sprite } from "./react.js";

describe("public Sprite contract", () => {
  it("exposes a data document, configured service and optional React host", () => {
    const document = characterSchema.parse({
      version: 1,
      name: "stranger",
      renderer: "video",
      controls: {},
      data: { clips: { idle: "idle.mp4" } },
    });
    expect(document.renderer).toBe("video");
    expect(createSprite).toBeTypeOf("function");
    expect(Sprite).toBeTypeOf("object");
  });
});
