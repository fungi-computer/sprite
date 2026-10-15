import { describe, expect, it } from "vitest";

import {
  agentAppearance,
  agentHueStep,
  avatarEnvelopeSchema,
  createAvatarSchema,
  deriveAgentAvatar,
  hexFromHsl,
  hslFromHex,
  hueDistance,
  legacyAvatar,
  parseAvatar,
  shiftHue,
  type Avatar,
  type AvatarCatalog,
} from "./avatar.js";
import type { Control } from "./controls.js";

const color = (hex: string): Control => ({
  type: "color",
  label: hex,
  default: hex,
});

const catalog: AvatarCatalog = {
  mushroom: {
    controls: {
      cap: color("#f98284"),
      capSpot: color("#ffe6c6"),
      body: color("#fff7e4"),
    },
    expressions: ["normal", "happy", "sad"],
    identitySlots: ["cap", "capSpot"],
  },
  cat: {
    controls: { body: color("#ffe6c6"), stripes: color("#dea38b") },
    expressions: ["normal", "happy"],
    identitySlots: ["body", "stripes"],
  },
  burger: {
    controls: { topBun: color("#f4a261"), bottomBun: color("#e9c46a") },
    expressions: ["normal"],
    identitySlots: ["topBun", "bottomBun"],
  },
};

const baseAvatar: Avatar = {
  v: 1,
  character: "mushroom",
  appearance: { cap: "#f98284", capSpot: "#ffe6c6" },
  expression: "normal",
  renderStyle: "plain",
};

describe("avatarEnvelopeSchema", () => {
  it("refuses an unknown character", () => {
    expect(() =>
      avatarEnvelopeSchema.parse({ ...baseAvatar, character: "robot" }),
    ).toThrow();
  });

  it("refuses a bad hex value", () => {
    expect(() =>
      avatarEnvelopeSchema.parse({
        ...baseAvatar,
        appearance: { cap: "not-a-color" },
      }),
    ).toThrow();
  });

  it("refuses more than 16 appearance keys", () => {
    const appearance = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`key${String(index)}`, 1]),
    );
    expect(() =>
      avatarEnvelopeSchema.parse({ ...baseAvatar, appearance }),
    ).toThrow();
  });

  it("accepts exactly 16 appearance keys", () => {
    const appearance = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`key${String(index)}`, 1]),
    );
    expect(() =>
      avatarEnvelopeSchema.parse({ ...baseAvatar, appearance }),
    ).not.toThrow();
  });
});

describe("createAvatarSchema (catalog-refined)", () => {
  it("refuses a foreign control key", () => {
    expect(() =>
      createAvatarSchema(catalog).parse({
        ...baseAvatar,
        appearance: { cap: "#f98284", wig: "#000000" },
      }),
    ).toThrow();
  });

  it("refuses an unknown expression", () => {
    expect(() =>
      createAvatarSchema(catalog).parse({
        ...baseAvatar,
        expression: "ecstatic",
      }),
    ).toThrow();
  });

  it("accepts a valid avatar for each catalog character", () => {
    expect(parseAvatar(baseAvatar, catalog).character).toBe("mushroom");
    expect(
      parseAvatar(
        { ...baseAvatar, character: "cat", appearance: { body: "#ffe6c6" } },
        catalog,
      ).character,
    ).toBe("cat");
    expect(
      parseAvatar(
        {
          ...baseAvatar,
          character: "burger",
          appearance: { topBun: "#f4a261" },
        },
        catalog,
      ).character,
    ).toBe("burger");
  });
});

describe("legacyAvatar", () => {
  it("matches agentAppearance for 1,000 seeds", () => {
    for (let index = 0; index < 1000; index += 1) {
      const seed = `agent-${String(index)}`;
      expect(legacyAvatar(seed).appearance).toEqual(agentAppearance(seed));
    }
  });

  it("is the mushroom, at rest, plain", () => {
    const avatar = legacyAvatar("agent-gardener");
    expect(avatar.character).toBe("mushroom");
    expect(avatar.expression).toBe("normal");
    expect(avatar.renderStyle).toBe("plain");
  });
});

describe("hueDistance", () => {
  it("wraps around the circle", () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(5, 5)).toBe(0);
  });
});

describe("agentHueStep", () => {
  const hueAt = (hue: number) => hexFromHsl(hue, 68, 72);

  it("is deterministic", () => {
    const hex = hueAt(100);
    expect(agentHueStep(hex, "agent-gardener")).toBe(
      agentHueStep(hex, "agent-gardener"),
    );
  });

  it("returns a step in the valid range", () => {
    const hex = hueAt(123);
    for (let index = 0; index < 200; index += 1) {
      const seed = `seed-${String(index)}`;
      const step = agentHueStep(hex, seed);
      expect(step).toBeGreaterThanOrEqual(40);
      expect(step).toBeLessThanOrEqual(320);
    }
  });

  it("the realised hue (after rounding to #rrggbb) clears 40 degrees for every hue and many seeds", () => {
    // The bug this guards: a step chosen in exact degrees can round to a hex
    // colour whose own decoded hue is a fraction of a degree short of 40,
    // once encode/decode rounding is applied. Sweep every hue, not just one.
    for (let hue = 0; hue < 360; hue += 1) {
      const hex = hueAt(hue);
      for (let index = 0; index < 5; index += 1) {
        const seed = `sweep-${String(hue)}-${String(index)}`;
        const step = agentHueStep(hex, seed);
        const realizedHue = hslFromHex(shiftHue(hex, step)).h;
        expect(hueDistance(realizedHue, hue)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("clears 40 degrees (realised) even when avoiding the hue directly opposite the member", () => {
    // Repro from review: avoid = [memberHue + 180] can make the exhaustive
    // search prefer a boundary step (40 or 320) whose realised hue, after
    // hex rounding, lands just under 40 degrees from the member.
    const memberHex = "#f98284";
    const memberHue = hslFromHex(memberHex).h;
    const avoid = [(memberHue + 180) % 360];
    for (let index = 0; index < 300; index += 1) {
      const seed = `opposite-${String(index)}`;
      const step = agentHueStep(memberHex, seed, avoid);
      const realizedHue = hslFromHex(shiftHue(memberHex, step)).h;
      expect(hueDistance(realizedHue, memberHue)).toBeGreaterThanOrEqual(40);
    }
  });

  it("prefers the step farthest (realised) from the avoided hues", () => {
    const hex = hueAt(0);
    const avoid = [170, 175, 180, 185, 190];
    const step = agentHueStep(hex, "agent-gardener", avoid);
    const realizedHue = hslFromHex(shiftHue(hex, step)).h;
    const fallbackRealizedHue = hslFromHex(shiftHue(hex, 180)).h;
    for (const hue of avoid) {
      expect(hueDistance(realizedHue, hue)).toBeGreaterThan(
        hueDistance(fallbackRealizedHue, hue),
      );
    }
  });
});

describe("shiftHue", () => {
  it("keeps saturation and lightness, rotates hue", () => {
    const shifted = shiftHue("#ff0000", 120); // red -> green-ish hue
    expect(shifted.toLowerCase()).toBe("#00ff00");
  });
});

describe("deriveAgentAvatar", () => {
  it.each(["#000000", "#cccccc", "#ffffff"])(
    "preserves resolved appearance when the primary identity colour is %s",
    (hex) => {
      const members: Avatar[] = [
        { ...baseAvatar, appearance: { cap: hex } },
        { ...baseAvatar, character: "cat", appearance: { body: hex } },
      ];
      for (const member of members) {
        const expected =
          member.character === "mushroom"
            ? { cap: hex, capSpot: "#ffe6c6", body: "#fff7e4" }
            : { body: hex, stripes: "#dea38b" };
        for (const avoid of [[], [0, 120, 240]]) {
          expect(
            deriveAgentAvatar(member, "shift", "agent-grey", catalog, avoid),
          ).toEqual({ ...member, appearance: expected });
        }
      }
    },
  );

  it("is deterministic", () => {
    const first = deriveAgentAvatar(baseAvatar, "shift", "agent-1", catalog);
    const second = deriveAgentAvatar(baseAvatar, "shift", "agent-1", catalog);
    expect(first).toEqual(second);
  });

  it("'keep' is the identity", () => {
    const kept = deriveAgentAvatar(baseAvatar, "keep", "agent-1", catalog);
    expect(kept).toEqual(baseAvatar);
  });

  it("'shift' never lands within 40 degrees of the member's identity hue", () => {
    const memberHue = hslFromHex(baseAvatar.appearance.cap).h;
    for (let index = 0; index < 50; index += 1) {
      const seed = `agent-${String(index)}`;
      const shifted = deriveAgentAvatar(baseAvatar, "shift", seed, catalog);
      const shiftedHue = hslFromHex(shifted.appearance.cap).h;
      expect(hueDistance(shiftedHue, memberHue)).toBeGreaterThanOrEqual(40);
    }
  });

  it("'shift' never lands within 40 degrees of any hue in avoid", () => {
    const avoid = [10, 50, 90];
    const shifted = deriveAgentAvatar(
      baseAvatar,
      "shift",
      "agent-contested",
      catalog,
      avoid,
    );
    const shiftedHue = hslFromHex(shifted.appearance.cap).h;
    for (const hue of avoid) {
      expect(hueDistance(shiftedHue, hue)).toBeGreaterThanOrEqual(40);
    }
  });

  it("only changes identity slots: expression, renderStyle and character stay", () => {
    const shifted = deriveAgentAvatar(baseAvatar, "shift", "agent-1", catalog);
    expect(shifted.character).toBe(baseAvatar.character);
    expect(shifted.expression).toBe(baseAvatar.expression);
    expect(shifted.renderStyle).toBe(baseAvatar.renderStyle);
  });

  it("only changes identity slots: a non-identity control stays put", () => {
    const withBody: Avatar = {
      ...baseAvatar,
      appearance: { ...baseAvatar.appearance, body: "#fff7e4" },
    };
    const shifted = deriveAgentAvatar(withBody, "shift", "agent-1", catalog);
    expect(shifted.appearance.body).toBe("#fff7e4");
  });
});
