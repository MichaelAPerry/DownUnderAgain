# Down Under Again: Architecture

A retro pixel-art ecosystem survival game, a spiritual successor to *Odell Down
Under* (MECC, 1994), set along a Florida river-to-sea transect.

## Stack

- **TypeScript (strict)** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Vite** for dev/build, **Vitest** for tests (headless, Node)
- **Canvas 2D** for the game, rendered at **384x216** and scaled up by whole numbers (`image-rendering: pixelated`)
- **Tailwind v4** for DOM menus layered over the canvas; *Press Start 2P* for menus, a custom 5x7 bitmap font for the HUD
- No runtime framework, no art or audio assets: sprites are generated from data, SFX are synthesised with WebAudio

## Layout

```
src/
  main.ts                 entry; mounts Game
  app/
    game.ts               controller: loop, input, audio, save, screen FSM, implements AppApi
    feedback.ts           session feedback events -> particles + sound
    layout.ts             whole-number canvas scaling
    api.ts                AppApi: the only surface UI screens may use
    screens.ts            Screen state machine + legal transition table
    save.ts               localStorage persistence; untrusted input is validated field by field
  engine/                 framework-free building blocks
    loop.ts               fixed 60 Hz timestep + render interpolation; pauses when tab hidden
    camera.ts input.ts audio.ts rng.ts spatialHash.ts eventBus.ts math.ts
  sim/                    deterministic simulation (no DOM, no Math.random)
    world.ts              entities, step order, spawn/kill, events
    foodWeb.ts            Eat / Flee / Ignore derived from diet tags + body length x jaw
    stats.ts              effective stats from upgrades, biomass
    types.ts              Entity, SimEvents
    systems/
      ai.ts               utility AI: think() picks a state, steer() turns it into velocity
      movement.ts         integration, floor/surface/root collisions, hiding in cover
      feeding.ts          mouth-contact bites, spines, armour, cleaning stations
      metabolism.ts       hunger, parasites + flashing, salinity & depth stress, healing
      spawner.ts          per-zone population targets, off-screen spawning, lionfish pressure
  world/
    terrain.ts            seeded floor profile, props, cover, mangrove roots, salinity field
    depth.ts              px <-> metres (stretched shallows, compressed abyss)
  data/
    schema.ts             content contracts (SpeciesDef, ZoneDef, UpgradeDef...)
    validate.ts           invariants TypeScript can't express (run in tests)
    palette.ts            the fixed retro palette
    upgrades.ts           Evolution Mode mutations
    sandbox.ts            Custom Fish point-buy -> SpeciesDef
    regions/florida/      zones, 22 creatures, 12 food items (compact tables via define.ts builders)
  modes/
    session.ts            one run: modes, stages, lives, score, biomass, codex discoveries
  render/
    worldRenderer.ts      composes the frame: baked scenery, live water effects, sprites, darkness, glow, particles
    env/                  scenery art: chunk cache (tiles), ground materials, props, sky/water backdrop
    art/                  colour ramps and raster helpers for the fish sprite generator
    hud.ts                meters, warnings, threat arrows, toasts
    fishSprite.ts         procedural shaded fish sprites from `look` (shape, colours, pattern)
    foodSprites.ts        hand-drawn plant / invertebrate sprites
    spriteCache.ts font.ts fontGlyphs.ts pixelSprite.ts
  ui/
    dom.ts                textContent-only DOM builder (no innerHTML anywhere)
    screens/*.ts          one ScreenView per menu screen
tests/                    Vitest: data invariants, food web, sim determinism/behaviour, sessions, save, sprites
e2e/                      Playwright smoke tests driving every screen in a real browser
```

## Screen state machine

```
title ──► modeSelect ──► speciesSelect ──► briefing ──► playing ◄──► paused ──► help
  │            │              │   ▲            ▲           │  ▲
  │            │              ▼   │            │           │  └──► shop (Evolution)
  │            └──(staged)────► sandbox ───────┘           ▼
  ├──► codex                                        stageEnd ──► briefing (retry / next fish)
  └──► help                                             │
                                                        ▼
                                                     results ──► briefing (play again) / modeSelect / title
```

`app/screens.ts` holds the transition table; illegal transitions are refused and
logged. Menus float over an *attract mode* reef that keeps simulating.

## Simulation

Fixed step (`SIM_DT = 1/60`), seeded RNG, so a run is reproducible from its seed
(there is a test that two worlds with the same seed stay identical).

Per step: think (AI, staggered ~5 Hz) → steer → integrate → rebuild spatial hash →
resolve mouth contacts → metabolism → remove dead → spawner.

**Food web.** `canEat(a, b)`: `b.foodTag ∈ a.diet` and either `b` is grazed
(algae, seagrass, coral, plankton) or `b.length ≤ a.length × a.jaw`. The cleaner
truce stops native predators eating cleaner gobies; invasive lionfish ignore it.
`relation()` turns that into Eat / Flee / Ignore, so custom fish and the Big Jaw
upgrade need no hand-written matrix.

**AI.** Each fish scores what it perceives (perception reduced by the target's
camouflage, hiding and ambush stillness) and picks a state: `flee`, `seekCleaner`
(or rub on the bottom to shed parasites), `hunt` / `forage`, or `wander`
(boids schooling plus a pull back toward home zone, preferred depth and tolerable
salinity). Ambush predators lurk and strike at short range; long chases are
abandoned.

**Survival model.** Energy drains by metabolism (more when bursting, fleeing,
salinity-stressed or out of depth). Health is lost when starving, overrun by
parasites, in the wrong salinity, or stung by spines. Parasites are shed at cleaner
gobies (instantly) or by "flashing" on the bottom (slowly).

**Ecosystem.** The spawner holds each species near its per-zone target, spawning
out of the player's sight. Lionfish targets grow over time (eased by removals)
and suppress small native reef fish.

## Modes

| Mode | Rules |
|---|---|
| Free Swim | any fish (or a custom fish); survive |
| Evolution | as Free Swim; meals earn Biomass; Tab opens the mutation shop |
| Tournament | every playable fish by body length, mosquitofish to great hammerhead; clear a stage by gaining 300% energy or surviving 120 s; 3 lives |
| Challenge | four random fish from rising size quartiles; one life |

## Model delegation used to build this

| Work | Model |
|---|---|
| Architecture, schema, sim, AI, food web, terrain, renderer, sprite generator, session, app controller, integration, balance, review | Opus |
| Florida species + food data and codex text | Sonnet (validated by `validateRegion` tests + manual biology review) |
| Six menu screens (briefing, paused, stage end, results, codex, help) | Sonnet (reviewed; one keyboard double-fire bug fixed) |
| Playwright e2e suite + CI job; compact species tables | Sonnet (data refactor proven identical against a JSON snapshot) |
| Shaded fish sprite generator; baked environment art and food sprites | Opus art passes (reviewed against rendered sheets and in-game screenshots) |
| Bitmap font glyphs, upgrade table | Haiku (font visually reviewed; one description corrected) |

## Rendering performance

Static scenery (terrain, props, distant silhouettes) is painted once into
256×128 world-space chunk canvases the first time each comes into view, in
four layers (far/near silhouettes, props behind fish, foreground). Up to 56
chunks are cached with least-recently-used eviction. Only animated details
(grass sway, caustics, light rays, surface, particles) are drawn live, which
keeps every zone at 60 fps.

Art tools: `npm run sprites` renders a contact sheet of every creature;
`npm run screenshots` captures each zone in a real browser.

## LAN multiplayer

Serverless and host-authoritative. The host's browser runs the real `World`;
guests send inputs and receive snapshots.

- **Pairing** (`net/signal.ts`): WebRTC with no STUN/TURN servers, so traffic
  stays on the LAN. The host's SDP offer becomes an *invite code*, the
  guest's answer a *reply code*. A data-channel SDP is mostly random keys, so
  instead of compressing it we pack only what a LAN connection needs (ICE
  credentials, DTLS fingerprint and role, UDP host candidates incl. mDNS
  names, SCTP settings) into under 100 bytes (~120-character codes, small QR codes) and
  rebuild a minimal SDP on the other side; deflated SDP is the fallback.
- **Channels**: `ctl` (reliable, JSON control messages) and `snap`
  (unreliable/unordered binary). Guests send 4-byte inputs at 30 Hz; the host
  sends each guest a 20 Hz snapshot of only the creatures near them
  (13 bytes each, positions to 1/8 px). Everything received is validated
  (`net/protocol.ts`).
- **Host** (`modes/lanHost.ts`): joins, names, scoring (eating a player ×3),
  kill feed, deaths and respawns, per-guest effects (sounds/particles).
- **Guest** (`modes/lanClient.ts`): rebuilds terrain from the host's seed,
  keeps interpolated proxy entities, streams input. The shared reef never
  pauses: pause and respawn menus overlay a live game.
- The sim gained per-player inputs (`World.addRemotePlayer`, `inputFor`) and
  spawns that avoid every player.

## Touch and single file

- `ui/touch/`: floating analogue joystick + BURST/PAUSE/EVOLVE buttons that
  drive the same `Input` the keyboard does; shown only on touch devices.
  Phones fill the screen with fractional nearest-neighbour scaling.
- `vite build --mode single` inlines JS, CSS and fonts into one HTML file,
  allowing the inline script by SHA-256 hash in the CSP; an e2e test plays it
  from `file://` with zero network requests.

## Security

- No `innerHTML` / `eval`; all text is set with `textContent` via `ui/dom.ts`
- Strict CSP in `index.html` (production builds drop the dev-only websocket allowance); fonts are bundled locally (no third-party requests)
- Save data and custom fish specs are parsed defensively and validated field by field (tests cover hostile input)
- The dev-only `window.__game` handle is stripped from production builds
