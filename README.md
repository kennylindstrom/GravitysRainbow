# Gravity's Rainbow

A full-screen 2D N-body gravity sandbox for the browser. A sun sits at the center of a compressed model of our solar system — slingshot planets into orbit and watch them interact, collide, and trace fading rainbow trails.

**▶ Play it:** https://kennylindstrom.github.io/GravitysRainbow/

## How to play

- **Launch a planet:** click/touch and *pull back* like a slingshot — the planet launches in the opposite direction. Pull farther for more speed.
- **Choose a size:** while holding, the planet throbs through sizes from Mercury to Jupiter. Release at the moment you want.
- **Aim with the preview:** a dotted line shows an estimate of the initial orbit, and a label shows mass (Earth masses), distance (AU), and speed relative to a circular orbit.
- **Collisions:** planets that hit the sun are destroyed. Planets that hit each other are destroyed too — or merge, if enabled in the menu.

### Controls

| Key | Action |
|---|---|
| Space | Pause / resume |
| `+` / `−` | Double / halve simulation speed |
| `C` | Clear all planets |
| `F` | Toggle fullscreen |

The **☰** menu (top right) has sliders for:

- **Solar mass** — 0.1× to 10×
- **Planet mass** — 1× to 1000× gravitational multiplier (makes planet–planet interactions visible)
- **Speed** — 1/16 to 64 simulated years per second
- **Trail length** — off to 2000 points
- **Merge planets on collision** — instead of both planets being destroyed, they combine into one planet (mass and momentum conserved) with a color blended from the two

**Create solar system** adds all eight planets with approximate real masses, orbital distances, and eccentricities. Their starting positions are illustrative, not the planets' current positions. The preset uses the current mass settings, so use the defaults for real masses; existing planets remain in the simulation.

**Clear planets** removes all planets, just like the `C` key.

After your third planet, the instructions collapse into the **ⓘ** button (top left).

## How it works

- **Physics:** simplified Newtonian N-body gravity — every body pulls on every other (including the sun) — integrated with velocity Verlet and an adaptive timestep. Units are AU, years, and solar masses (G = 4π²).
- **Scale:** the view uses a square-root radial compression so both the inner planets and Neptune (~30 AU) fit on screen. Faint rings mark the real orbits of Mercury through Neptune.
- **Masses:** planet masses span the real solar-system range (Mercury ≈ 0.055 M⊕ to Jupiter ≈ 318 M⊕) on a log scale; displayed sizes are compressed.
- **Orbit preview:** a two-body (sun-only) estimate, so real paths may drift due to other planets.

## Running locally

No build step or dependencies — just open `index.html` in a modern browser, or serve the folder:

```sh
npx serve .
```

## License

[MIT](LICENSE)
