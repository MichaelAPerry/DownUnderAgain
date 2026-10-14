# Down Under Again

**▶ Play it: https://michaelaperry.github.io/DownUnderAgain/** (live once GitHub Pages is enabled; see [Publishing](#publishing))

A retro pixel-art ecosystem survival game and a fan-made spiritual successor to
the 1994 classic *Odell Down Under*. It moves the action to Florida. You play a
fish on a continuous river-to-sea transect, eating, avoiding being eaten,
keeping your parasites down and staying in water you can survive in.

```
Spring Run → Mangrove Estuary → Seagrass Flats → Florida Keys Reef → Gulf Stream Drop-off
  (fresh)        (brackish)          (salt) ─────────────────────────────►       ↓
                                                                          Twilight Zone (150 m+)
```

## Features

- **21 playable Florida species** across four tiers, plus a Florida manatee and 12 kinds of plants, plankton and invertebrates. Species range from the eastern mosquitofish to the great hammerhead
- **A living ecosystem.** AI fish hunt, school, flee, graze, hide, visit cleaner gobies and rub off parasites. Populations refill out of sight, so the reef never feels staged
- **Rule-based food web.** Who eats whom comes from diet and jaw size, not a hand-written table. On-screen cues show what you can eat (green) and what has spotted you (red **!**)
- **Real Florida ecology:**
  - salinity tolerance: freshwater fish suffer in the sea, and bull sharks and snook cross between the two
  - depth ranges and a dark twilight zone with bioluminescent lanternfish
  - hiding in seagrass, mangrove roots and reef crevices
  - the cleaner-goby truce
  - **invasive lionfish** that spread unless eaten (eating one scores double)
- **Four modes:**
  - **Free Swim**: any fish, survive as long as you can
  - **Evolution**: eat to earn Biomass, then press Tab to mutate mid-run (Power Fins, Big Jaw, Camouflage, Spike Spines…)
  - **Tournament**: climb the whole food chain from smallest to largest, with 3 lives
  - **Challenge**: four random fish of growing size, one life
- **Custom Fish Sandbox.** Spend 20 points on size, speed, senses, jaw, camouflage, spines, armor and efficiency, then pick diet, home zone, shape, pattern and colours. The pixel art is generated from your design
- **Reef Codex**: a field guide that fills in as you meet each creature, with its diet, predators, status and a fact
- Authentic low-res look: 384×216 canvas scaled by whole numbers, a fixed retro palette, a bitmap HUD font and synthesized chiptune effects. **Zero image or audio assets**

## Controls

| Key | Action |
|---|---|
| WASD / Arrow keys | Swim |
| Hold left mouse button | Swim toward the cursor |
| Shift / Space | Burst (uses extra energy) |
| Esc / P | Pause |
| Tab | Evolve (Evolution mode) |
| C | Toggle food-web cues |
| M | Mute |

**Survival tips:** eat mouth-first. Shed parasites at a cleaner goby on the reef or by resting on the sand. Watch the salinity readout in the bottom-left corner. Small fish are safest in cover.

## Development

Requires Node 22+.

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run check      # strict typecheck + test suite
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

The code is TypeScript with Vite, Vitest, Canvas 2D and Tailwind v4, and has no runtime framework.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout, screen
state machine, simulation design and food-web rules.

## Publishing

The workflow in `.github/workflows/pages.yml` typechecks, tests and builds every
pull request. On every push to `main` it deploys to GitHub Pages.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
After that, each merge to `main` publishes the game. You can also run the
workflow by hand from the Actions tab.

The build uses relative asset paths, so it works under the project URL
(`/DownUnderAgain/`) or any other host and subfolder.

## Credits

Fan-made tribute; not affiliated with MECC, SoftKey or the original game's rights holders.
Species facts are summarised from general reference knowledge for education. Corrections are welcome.
Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (SIL Open Font License), bundled via Fontsource.
Code is MIT licensed (see `LICENSE`).
