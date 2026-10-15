import { describe, expect, it } from "vitest";
import { characterSchema } from "./document.js";

describe("portable character envelope", () => {
  it("accepts data without importing or installing its renderer", () => {
    expect(
      characterSchema.parse({
        version: 1,
        name: "Goblin",
        renderer: "frames",
        data: { pages: ["atlas.png"] },
      }).controls,
    ).toEqual({});
  });

  it("rejects unsupported versions and executable-plugin fields", () => {
    const document = {
      version: 1,
      name: "Goblin",
      renderer: "frames",
      data: {},
    };
    expect(() => characterSchema.parse({ ...document, version: 2 })).toThrow();
    expect(() =>
      characterSchema.parse({
        ...document,
        module: "https://example.com/plugin.js",
      }),
    ).toThrow();
  });
});
