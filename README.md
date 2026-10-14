# Down Under Again

A retro pixel-art ecosystem survival game and a fan-made spiritual successor to
the 1994 classic *Odell Down Under*. It moves the action to Florida. You play a
fish on a continuous river-to-sea transect: **Spring Run → Mangrove Estuary →
Seagrass Flats → Florida Keys Reef → Gulf Stream Drop-off → Twilight Zone**. Eat,
avoid being eaten, keep your parasites down, and stay in water you can survive in.

## Features

- **21 playable Florida species** across four tiers (herbivores, omnivores, carnivores, apex predators), plus a manatee and 12 kinds of food: plants, plankton and invertebrates
- **A living ecosystem.** AI fish hunt, school, flee, graze, visit cleaner gobies and rub off parasites. Populations refill out of sight
- **Rule-based food web.** Who eats whom comes from diet and jaw size, and on-screen cues show what you can eat and what has spotted you
- **Real ecology**: salinity tolerance (freshwater fish can't survive the sea), depth ranges, hiding in seagrass and mangrove roots, the cleaner-goby truce, and **invasive lionfish** that spread unless eaten
- **Four modes**: Free Swim, Evolution (spend Biomass on mutations mid-run), Tournament (climb the whole food chain) and Challenge (four random fish, one life)
- **Custom Fish Sandbox.** Spend 20 points on size, speed, jaw, camouflage, spines and more. Your fish's look is generated from your choices
- **Reef Codex**: an encyclopedia that fills in as you meet each creature, including what it eats and what eats it
- Pixel-perfect 384x216 rendering, a deep-sea darkness with bioluminescence, and synthesized chiptune sound effects. No external assets

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

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + tests
npm run build      # production build in dist/
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

*Fan-made and not affiliated with the original game's publishers.*
