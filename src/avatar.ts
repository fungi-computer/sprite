import * as z from "zod";

import type { Control } from "./controls.js";
import { resolveAppearance } from "./controls.js";
import { renderStyleSchema } from "./render-style.js";

/**
 * The closed v1 catalog of avatar characters. Adding a character is a new
 * major version; this list is not meant to grow silently.
 */
export const avatarCharacters = ["mushroom", "cat", "burger"] as const;

/** One character in the closed v1 avatar catalog. */
export type AvatarCharacter = (typeof avatarCharacters)[number];

/** A saved `agentColors` preference: shift an Agent's identity, or copy it. */
export const agentColorsSchema = z.enum(["shift", "keep"]);

/** Whether an Agent created from a member's avatar wears a shifted identity. */
export type AgentColors = z.infer<typeof agentColorsSchema>;

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
/** Appearance values a v1 avatar may carry: a hex colour, a number, or a flag. */
const avatarAppearanceValue = z.union([hexColor, z.number(), z.boolean()]);
const MAX_APPEARANCE_KEYS = 16;

/**
 * The Avatar v1 envelope: a closed character, up to 16 appearance values, a
 * resting expression, and a render style. It is a complete snapshot, not a
 * reference into character data, so it survives a later change to the
 * catalog. This checks shape only; it does not know a character's real
 * controls or expressions, so a bound catalog cannot validate against it by
 * name alone. `createAvatarSchema`/`parseAvatar` build the catalog-refined
 * schema a caller should actually parse untrusted data with; `sprite-zdog`'s
 * `avatarSchema` is that schema, bound to the built-in catalog.
 */
export const avatarEnvelopeSchema = z.strictObject({
  v: z.literal(1),
  character: z.enum(avatarCharacters),
  appearance: z
    .record(z.string().min(1), avatarAppearanceValue)
    .refine(
      (appearance) => Object.keys(appearance).length <= MAX_APPEARANCE_KEYS,
      {
        message: `Avatar appearance cannot exceed ${String(MAX_APPEARANCE_KEYS)} keys`,
      },
    ),
  expression: z.string().min(1),
  renderStyle: renderStyleSchema,
});

/** A parsed, envelope-valid Avatar v1 descriptor. */
export type Avatar = z.infer<typeof avatarEnvelopeSchema>;

/** Pure per-character facts a catalog owner (e.g. `sprite-zdog`) supplies. */
export type AvatarCatalogEntry = {
  /** Every control the character's document declares. */
  readonly controls: Readonly<Record<string, Control>>;
  /** Every expression name the character's document declares. */
  readonly expressions: readonly string[];
  /** Controls that carry the character's identity colour, in priority order. */
  readonly identitySlots: readonly string[];
};

/** Pure character facts for every avatar character, owned by its renderer. */
export type AvatarCatalog = Readonly<
  Record<AvatarCharacter, AvatarCatalogEntry>
>;

/**
 * Build the full avatar schema for a catalog: the envelope above, refined so
 * every appearance key is one of the character's controls, every value is
 * typed by that control, and the expression is one the character declares.
 */
export function createAvatarSchema(catalog: AvatarCatalog) {
  return avatarEnvelopeSchema.superRefine((avatar, context) => {
    const entry = catalog[avatar.character];
    try {
      resolveAppearance(entry.controls, avatar.appearance);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["appearance"],
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!entry.expressions.includes(avatar.expression)) {
      context.addIssue({
        code: "custom",
        path: ["expression"],
        message: `Unknown avatar expression for ${avatar.character}: ${avatar.expression}`,
      });
    }
  });
}

/** Parse an unknown value into a catalog-valid Avatar v1 descriptor. */
export function parseAvatar(data: unknown, catalog: AvatarCatalog): Avatar {
  return createAvatarSchema(catalog).parse(data);
}

/** A hexadecimal colour decomposed into hue (degrees), saturation, lightness. */
export type Hsl = {
  readonly h: number;
  readonly s: number;
  readonly l: number;
};

/** Encode HSL (hue in degrees, saturation/lightness in percent) as `#rrggbb`. */
export function hexFromHsl(
  hue: number,
  saturation: number,
  lightness: number,
): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Decode a `#rrggbb` colour into HSL (hue in degrees, saturation/lightness in percent). */
export function hslFromHex(hex: unknown): Hsl {
  const parsed = hexColor.parse(hex);
  const r = Number.parseInt(parsed.slice(1, 3), 16) / 255;
  const g = Number.parseInt(parsed.slice(3, 5), 16) / 255;
  const b = Number.parseInt(parsed.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = (((g - b) / delta) % 6) * 60;
  else if (max === g) h = ((b - r) / delta + 2) * 60;
  else h = ((r - g) / delta + 4) * 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

const normalizeHue = (hue: number): number => ((hue % 360) + 360) % 360;

/** Shortest angular distance between two hues in degrees, 0 to 180. */
export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeHue(a) - normalizeHue(b)) % 360;
  return Math.min(diff, 360 - diff);
}

/** Lower bound (degrees) every colour-shift step must clear, each direction. */
export const AGENT_HUE_MIN_SHIFT = 40;
/** `agentHueStep`'s deterministic step range has exactly this many values. */
const SHIFT_RANGE = 281;

/**
 * A deterministic FNV-1a hash: the same seed always lands on the same value.
 * A copy of `@fungi.computer/caps`'s `seedHash` so this package stays free of
 * a React-package dependency; both must keep computing the same value.
 */
export function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (const unit of seed) {
    hash ^= unit.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The hue-rotation step for `seed`, chosen against `hex`'s own realised
 * result, not the idealised `hue + step` arithmetic: `shiftHue` rounds to a
 * `#rrggbb` colour, and re-decoding that colour can land a few tenths of a
 * degree short of an exact-degree step, which the 40-degree guarantee must
 * still hold against. A step is only a candidate when rotating `hex` by it
 * and reading the result's hue back out clears 40 degrees from `hex`'s own
 * hue. When `avoid` carries other agents' identity hues, the candidate
 * farthest from all of them (by minimum distance, scored on the same
 * realised hue) is preferred; ties keep whichever candidate is nearest the
 * seed's own deterministic default step, so an unconflicted seed keeps its
 * usual look.
 */
export function agentHueStep(
  hex: string,
  seed: string,
  avoid: readonly number[] = [],
): number {
  const memberHue = hslFromHex(hex).h;
  const fallbackStep = AGENT_HUE_MIN_SHIFT + (seedHash(seed) % SHIFT_RANGE);
  const blocked = avoid.map(normalizeHue);
  const realizedHue = (step: number) => hslFromHex(shiftHue(hex, step)).h;
  const clearsMember = (step: number) =>
    hueDistance(realizedHue(step), memberHue) >= AGENT_HUE_MIN_SHIFT;
  const avoidScore = (step: number) =>
    blocked.length === 0
      ? 0
      : Math.min(...blocked.map((hue) => hueDistance(realizedHue(step), hue)));

  let bestStep: number | undefined;
  let bestScore = -1;
  let bestDistanceToFallback = Infinity;
  for (
    let step = AGENT_HUE_MIN_SHIFT;
    step <= 360 - AGENT_HUE_MIN_SHIFT;
    step += 1
  ) {
    if (!clearsMember(step)) continue;
    const score = avoidScore(step);
    const distanceToFallback = Math.abs(step - fallbackStep);
    if (
      bestStep === undefined ||
      score > bestScore ||
      (score === bestScore && distanceToFallback < bestDistanceToFallback)
    ) {
      bestStep = step;
      bestScore = score;
      bestDistanceToFallback = distanceToFallback;
    }
  }
  if (bestStep === undefined)
    throw new Error(
      `No colour-shift step clears ${String(AGENT_HUE_MIN_SHIFT)} degrees for ${hex}`,
    );
  return bestStep;
}

/** Rotate one hex colour's hue by `step` degrees, keeping its saturation and lightness. */
export function shiftHue(hex: string, step: number): string {
  const { h, s, l } = hslFromHex(hex);
  return hexFromHsl(normalizeHue(h + step), s, l);
}

/**
 * The mushroom's two identity controls for one seed: its cap and cap spots
 * take a hue from the seed, so an Agent wears the same cap in every list it
 * appears in. Kept byte-identical to the Sprite seen before avatars existed.
 */
export type AgentAppearance = Readonly<{
  /** Cap colour as a hexadecimal CSS colour. */
  cap: string;
  /** Cap spot colour as a hexadecimal CSS colour. */
  capSpot: string;
}>;

/** The seeded mushroom identity colours for `seed`. */
export function agentAppearance(seed: string): AgentAppearance {
  const hue = seedHash(seed) % 360;
  return { cap: hexFromHsl(hue, 68, 72), capSpot: hexFromHsl(hue, 70, 92) };
}

/**
 * The avatar an Agent wears until its owner chooses one: the mushroom, in the
 * cap colour seeded from the Agent's id, at rest, undecorated. It is a pure
 * function of identity, so hosts compute it instead of storing it.
 */
export function seededAvatar(seed: string): Avatar {
  return {
    v: 1,
    character: "mushroom",
    appearance: agentAppearance(seed),
    expression: "normal",
    renderStyle: "plain",
  };
}

/**
 * Derive an Agent's avatar from its creator's, for a catalog's character.
 * `"keep"` hands back the member's look unchanged (their Agent is a visible
 * copy, told apart only by name). `"shift"` resolves the member's full
 * appearance against the catalog and rotates only the character's identity
 * slots by one shared hue step, so accessories, face and drawing style carry
 * over untouched. `avoid` lists hues already worn by the creator's other
 * Agents so a new one does not land beside them. An achromatic primary
 * identity colour has no hue to rotate, so its resolved appearance is kept.
 */
export function deriveAgentAvatar(
  member: Avatar,
  agentColors: AgentColors,
  seed: string,
  catalog: AvatarCatalog,
  avoid: readonly number[] = [],
): Avatar {
  if (agentColors === "keep") return { ...member };
  const characterEntry = catalog[member.character];
  const resolved = resolveAppearance(
    characterEntry.controls,
    member.appearance,
  );
  // Every identity slot whose control is a colour, with its resolved hex
  // value already parsed (not asserted): the control's declared type is the
  // contract, not the resolved value's runtime shape.
  const identityHues = characterEntry.identitySlots.flatMap((slot) => {
    const control = characterEntry.controls[slot];
    return control?.type === "color"
      ? [{ slot, hex: hexColor.parse(resolved[slot]) }]
      : [];
  });
  const primary = identityHues[0];
  if (!primary || hslFromHex(primary.hex).s === 0)
    return { ...member, appearance: resolved };
  const step = agentHueStep(primary.hex, seed, avoid);
  const shiftedBySlot = new Map(
    identityHues.map(({ slot, hex }) => [slot, shiftHue(hex, step)]),
  );
  const appearance = Object.fromEntries(
    Object.entries(resolved).map(([key, value]) => [
      key,
      shiftedBySlot.get(key) ?? value,
    ]),
  );
  return { ...member, appearance };
}
