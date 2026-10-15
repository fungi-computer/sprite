import * as z from "zod";

import { renderStyleSchema } from "./render-style.js";

/**
 * What a person saves about their Sprite. Hosts parse stored values with this
 * schema at their boundary; character controls still validate `appearance`
 * against the selected document when it is presented.
 */
export const customizationSchema = z.strictObject({
  appearance: z
    .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  renderStyle: renderStyleSchema.default("plain"),
});

/** A parsed, saved Sprite customization. */
export type Customization = z.infer<typeof customizationSchema>;
