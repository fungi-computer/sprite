import * as z from "zod";

const label = z.string().trim().min(1);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const numberControl = z
  .strictObject({
    type: z.literal("number"),
    label,
    default: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
  })
  .refine(
    (control) =>
      control.min <= control.default && control.default <= control.max,
    {
      message: "Number control default must be within its bounds",
    },
  );
const choiceControl = z
  .strictObject({
    type: z.literal("choice"),
    label,
    default: z.string(),
    options: z.array(z.strictObject({ value: z.string(), label })).min(1),
  })
  .refine(
    (control) =>
      control.options.some((option) => option.value === control.default) &&
      new Set(control.options.map((option) => option.value)).size ===
        control.options.length,
    {
      message: "Choice control needs unique options and a declared default",
    },
  );

/** Portable editor descriptors; native input bindings belong to each renderer. */
export const controlSchema = z.discriminatedUnion("type", [
  numberControl,
  choiceControl,
  z.strictObject({ type: z.literal("color"), label, default: color }),
  z.strictObject({ type: z.literal("boolean"), label, default: z.boolean() }),
]);

/** A validated, character-owned customization control. */
export type Control = z.infer<typeof controlSchema>;
/** Values saved by the shell; no renderer objects or transient activity. */
export type Appearance = Readonly<Record<string, string | number | boolean>>;

/** Validate the complete appearance before applying any native updates. */
export function resolveAppearance(
  controls: Readonly<Record<string, Control>>,
  overrides: Appearance = {},
): Appearance {
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(controls, key))
      throw new Error(`Unknown appearance control: ${key}`);
  }
  return Object.fromEntries(
    Object.entries(controls).map(
      ([key, control]): [string, string | number | boolean] => {
        const value = Object.hasOwn(overrides, key)
          ? overrides[key]
          : control.default;
        switch (control.type) {
          case "number":
            return [
              key,
              z.number().min(control.min).max(control.max).parse(value),
            ];
          case "color":
            return [key, color.parse(value)];
          case "boolean":
            return [key, z.boolean().parse(value)];
          case "choice": {
            const selected = z.string().parse(value);
            if (!control.options.some((option) => option.value === selected)) {
              throw new Error(`Unknown choice for ${key}: ${selected}`);
            }
            return [key, selected];
          }
        }
      },
    ),
  );
}
