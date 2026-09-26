# QUANTARA — Quantum-Inspired Transportation Digital Twin & Route Optimization Platform

Built for Smart India Hackathon 2026 (PS-26137). Node/TypeScript backend, React/Vite frontend.

**Honesty note up front:** "quantum-inspired" describes the *algorithm* (QPSO — Quantum-behaved Particle
Swarm Optimization), not the *hardware*. Everything in this repository runs on ordinary CPUs. Nothing
here uses, simulates in the quantum sense, or requires quantum hardware. See `docs/QPSO.md`.

## What this is

A digital twin of a delivery fleet operating on a real, named road network (Pune-centred, 78 junctions,
176 named roads / 352 directed edges), with:

- Six real optimization algorithms (QPSO, Adaptive QPSO, PSO, GA, Simulated Annealing, an exact
  exhaustive solver for small instances) sharing one objective function and one constraint set.
- A stateful **Digital Twin** (`backend/src/twin/engine.ts`) that road closures, accidents, traffic
  surges, vehicle breakdowns and weather changes are applied to, and that every plan is computed from.
- **Scenario analysis** (what-if, resilience, regret, counterfactual, time-window risk) computed by
  cloning the twin and re-simulating / re-optimizing — never by hard-coded multipliers.
- Turn-by-turn **directions** derived from the actual path the optimizer evaluated on the graph.
- An **actual-vs-predicted learning loop** that honestly reports "insufficient data" until it has enough
  observations to say something.
- **FRIDAY**, a tool-calling assistant with an on-device trained intent classifier (no LLM required) plus
  optional Groq/Gemini for open-ended phrasing.
- A **21-step SIH Demo Mode** that executes real backend calls end to end, for live presentation.
- A **benchmark engine** (5 fixed seeds, Mann-Whitney U significance testing, hardware/fairness metadata)
  and a **scalability test** (N = 10…500, measured, never estimated — sizes beyond a runtime budget are
  reported `NOT EXECUTED` with the extrapolated reason, not silently estimated).

## Quick start

```bash
cd backend && cp .env.example .env   # fill in JWT_SECRET at minimum; everything else is optional
npm install
npm run dev            # http://localhost:5000

cd ../frontend
npm install
npm run dev             # http://localhost:5173, proxies /api to :5000
```

Demo accounts are seeded automatically: `admin@qroute.in` / `admin123` (full access) and
`citizen@qroute.in` / `citizen123` (read-only, delivery-status views).

Without `MONGODB_URI` set, the backend uses an in-memory store — fine for demos, but data does not
survive a restart. Without `TOMTOM_API_KEY`, traffic and route geometry fall back to internal simulation
(clearly labelled `SIMULATED` / `FALLBACK` everywhere in the UI and API, never presented as live data).

## Running the SIH demo

1. Open `/sih-demo` as an admin user.
2. Press **Start demo**. All 21 steps run against the real twin, optimizer, scenario engine, learning
   store and benchmark engine — nothing is scripted output. Use Pause/Resume/Next to control pacing live.

## Tests

```bash
cd backend && npm test        # 7 suites / 77 tests: algorithms, twin, FRIDAY, demo, API, security
cd frontend && npx tsc -b && npx vite build   # typecheck + production build
```

## Documentation

- `docs/ARCHITECTURE.md` — how the pieces fit together (Digital Twin → Graph → Optimization → Route → Fleet → UI)
- `docs/QPSO.md` — what QPSO/Adaptive QPSO actually are, and why they are not quantum computing
- `docs/DIGITAL_TWIN.md` — the twin's state model and event/re-optimization flow
- `docs/BENCHMARKING.md` — how the benchmark and scalability numbers are produced
- `docs/FRIDAY.md` — the on-device classifier, tool registry, and LLM fallback

## Known limitations (stated honestly, not hidden)

- Traffic is simulated unless a TomTom key is configured; the UI labels this everywhere.
- The exact solver only runs up to 9 deliveries (factorial blow-up beyond that).
- The actual-vs-predicted learning loop needs 20 observations before it reports trends; before that it
  says so instead of guessing.
- No air-quality provider is integrated; the Weather page reports AQI as unavailable rather than inventing
  a number.
