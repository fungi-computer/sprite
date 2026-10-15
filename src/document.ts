import * as z from "zod";
import { controlSchema } from "./controls.js";

/** Shared envelope only. The selected adapter must decode data before use. */
export const characterSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().trim().min(1),
  renderer: z.string().trim().min(1),
  controls: z.record(z.string().min(1), controlSchema).default({}),
  poster: z.string().min(1).optional(),
  data: z.json(),
});

/** A portable character, with renderer data still awaiting its native decoder. */
export type CharacterDocument = z.infer<typeof characterSchema>;

/** Domain key for a character installed by the host. */
export const localCharacterSourceSchema = z.strictObject({
  local: z.string().trim().min(1),
});

/** A served document URL or a host-installed character key. */
export type CharacterSource = string | { readonly local: string };
