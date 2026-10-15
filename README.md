# Sprite (`@fungi.computer/sprite`)

Sprite presents a character document through a host-installed renderer, so a
game or app can show an animated avatar without writing its own rendering layer.
The host chooses local characters, renderer adapters, network origins, and asset
limits. Each mounted player owns its current source and presentation lifetime.

## Install or set up

```sh
npm install @fungi.computer/sprite
```

The package ships ESM only and depends on Effect, Zod, and
[Cairn](../cairn/README.md) at runtime. React is an optional peer dependency,
needed only for the `./react` entrypoint. The core entrypoint,
`@fungi.computer/sprite`, exports the renderer-neutral player API.
`@fungi.computer/sprite/react` exports the React provider and component.
`@fungi.computer/sprite/video` exports the optional video renderer. `./avatar`
supplies avatar descriptors and catalog-aware validation. `./ink` and
`./mycelium` mount decorative drawings independently of the character player.
Zdog support ships as the separate [Sprite Zdog](../sprite-zdog/README.md)
package.

## Quick start

This illustrative React example configures the host's asset policy and lazy
video renderer, then presents a character document:

```tsx
import { createSprite } from "@fungi.computer/sprite";
import { Sprite, SpriteProvider } from "@fungi.computer/sprite/react";

const service = createSprite({
  assets: {
    baseURL: window.location.href,
    allowedOrigins: [window.location.origin],
    maxBytes: 2_000_000,
    maxTotalBytes: 4_000_000,
    maxRequests: 4,
  },
  renderers: {
    video: () => import("@fungi.computer/sprite/video"),
  },
});

function Character() {
  return (
    <SpriteProvider service={service}>
      <Sprite
        src="/characters/my-avatar.json"
        activity="idle"
        role="img"
        aria-label="My avatar"
      />
    </SpriteProvider>
  );
}
```

The package tests exercise player updates, React lifetime, and asset admission.
See [`src/player.test.ts`](src/player.test.ts),
[`src/react.test.tsx`](src/react.test.tsx), and
[`src/assets.test.ts`](src/assets.test.ts).

## Core concepts

A character document has `version: 1`, a name, a renderer name, optional
controls and poster, and renderer-specific `data`. The shared schema validates
that envelope. The selected adapter validates its own data. A source is either a
document URL or `{ local: "key" }` for a character installed by the host.

`createSprite` creates a stable host service. The host supplies local
characters, renderer loaders, and asset policy. A player selects one source and
receives activity, expression, appearance, and render-style updates without
replacing its host element. The React `Sprite` owns one player and disposes it
when it unmounts. The imperative player exposes `set`, `pause`, `subscribe`, and
asynchronous `dispose`.

`renderStyle` applies one of the built-in SVG filters: `plain`, `pencil`,
`manga`, `riso`, `halftone`, `blueprint`, `crt`, or `watercolor`. Each player
owns its filter instance. Animated styles pause when the player is paused, is
offscreen, the page is hidden, or reduced motion is requested.

Remote documents and nested assets pass through one reader. The host sets
allowed origins, the maximum bytes per response, total bytes per selection, and
request count. Local characters need no remote asset policy. Video uses the
configured `video` renderer and reads clip assets through that same path.

The React `Sprite` takes `src`, optional `activity`, `expression`, `appearance`
and `renderStyle`, plus ordinary attributes for its host `div`. Pass `paused` to
suspend it and `onState` to observe player states. A direct `service` prop
overrides `SpriteProvider`; one of them is required.

### Saved avatars

`@fungi.computer/sprite/avatar` defines the v1 descriptor: `v`, `character`,
`appearance`, `expression` and `renderStyle`. `avatarEnvelopeSchema` checks only
that envelope. Use `createAvatarSchema(catalog)` or `parseAvatar(data, catalog)`
to also validate the selected character's controls and expressions. Sprite Zdog
supplies a validator bound to its built-in catalog.

### Decorative drawings

`mountInkDrawing(host, { art, palette, ...options })` from `./ink` paints traced
art with Canvas 2D. The palette is a callback; call the returned `redraw()`
after a theme change and `destroy()` when the host leaves.

`mountMycelium(host, { pixi, palette, ...options })` from `./mycelium` returns a
Promise for a growing field with `pulse()` and `destroy()`. The host supplies
Pixi 8 and the palette. Both drawings respect reduced motion and release their
canvas and observers through `destroy()`.

## API reference

See the generated [Sprite API reference](docs/api/README.md). Import the
renderer-neutral player API from `@fungi.computer/sprite`, the React provider
and component from `@fungi.computer/sprite/react`, and the video adapter from
`@fungi.computer/sprite/video`. The reference also covers `./avatar`; the
decorative `./ink` and `./mycelium` contracts are described above.

## Examples and checks

The video workbench story presents a character with multiple clips and changes
the activity to select a clip. Start the local Ladle workbench from the
repository root with:

```sh
pnpm --filter @fungi.computer/sprite exec ladle serve
```

Run the package tests with:

```sh
pnpm --filter @fungi.computer/sprite test
```

## Limits and errors

Sprite validates the shared document envelope, not renderer-specific data. The
host must configure the renderer named by a served document and review its asset
policy. Without an asset policy, remote origins are denied. Video codec support
depends on the browser and the encoded file.

The built-in render styles draw through an SVG filter. Reduced-motion
preferences, pause state, offscreen status, and page visibility suspend styles
that animate. A still frame remains. `poster` supplies a loading image, not a
replacement for host asset limits.

## Contribute and license

Sprite is MIT licensed. See [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES).
