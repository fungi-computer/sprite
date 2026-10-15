import { describe, expect, it } from "vitest";
import { controlSchema, resolveAppearance } from "./controls.js";

describe("character customization", () => {
  const controls = {
    cap: controlSchema.parse({
      type: "color",
      label: "Cap",
      default: "#f98284",
    }),
    hair: controlSchema.parse({
      type: "number",
      label: "Hair",
      min: 0,
      max: 10,
      default: 0,
    }),
    outfit: controlSchema.parse({
      type: "choice",
      label: "Outfit",
      default: "worker",
      options: [
        { value: "worker", label: "Worker" },
        { value: "sailor", label: "Sailor" },
      ],
    }),
  };

  it("resolves defaults and explicit choices without mutating character data", () => {
    expect(resolveAppearance(controls, { outfit: "sailor" })).toEqual({
      cap: "#f98284",
      hair: 0,
      outfit: "sailor",
    });
    expect(resolveAppearance(controls).outfit).toBe("worker");
  });

  it("rejects stale or invalid overrides instead of silently claiming they applied", () => {
    for (const values of [
      { removed: true },
      { hair: 11 },
      { hair: NaN },
      { hair: "5" },
      { cap: "red" },
      { outfit: "missing" },
    ]) {
      expect(() => resolveAppearance(controls, values)).toThrow();
    }
  });

  it("rejects unusable descriptors at the document boundary", () => {
    expect(() =>
      controlSchema.parse({
        type: "number",
        label: "Size",
        min: 5,
        max: 2,
        default: 3,
      }),
    ).toThrow();
    expect(() =>
      controlSchema.parse({
        type: "choice",
        label: "Style",
        default: "a",
        options: [
          { value: "a", label: "A" },
          { value: "a", label: "Duplicate" },
        ],
      }),
    ).toThrow();
  });
});
