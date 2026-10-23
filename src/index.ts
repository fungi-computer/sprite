export { createSprite } from "./player.js";
export type {
  AvatarPlayer,
  AvatarPresentation,
  EffectivePresentation,
  LocalCharacter,
  NativePlayer,
  NativePresentation,
  PlayerState,
  Renderer,
  RendererContext,
  SpriteOptions,
  SpriteService,
} from "./player.js";
export { characterSchema } from "./document.js";
export type { CharacterDocument, CharacterSource, Json } from "./document.js";
export { controlSchema, resolveAppearance } from "./controls.js";
export type { Appearance, Control } from "./controls.js";
export type { Asset, AssetPolicy } from "./assets.js";
export {
  createRenderStyleLayer,
  renderStyleLabels,
  renderStyles,
  renderStyleSchema,
} from "./render-style.js";
export type { RenderStyle, RenderStyleLayer } from "./render-style.js";
export { customizationSchema } from "./customization.js";
export type { Customization } from "./customization.js";
