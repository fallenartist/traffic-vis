# Analiza ruchu w Gliwicach

A Mapbox / Three.js traffic map with 3D Sankey ribbons and a 2D point-density view.

## Run

Requires Node 22.12+ (or Node 20.19+) and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Vite. `pnpm test` checks closed-network accounting, bearing modes, and gap-free geometry. `pnpm build` creates `dist/`; `pnpm preview` serves that build.

Set `VITE_MAPBOX_TOKEN` in ignored `.env.local` for development; see `.env.example`. There is no hard-coded token or production fallback in source. GitHub Actions obtains the production token from the encrypted repository secret `VITE_MAPBOX_TOKEN`. `VITE_MAPBOX_STYLE` optionally overrides the original custom style. Mapbox access and an internet connection are needed to load the map. The public browser token is embedded in the deployed JavaScript and visible to visitors; keeping it in Actions Secrets keeps it out of GitHub source, not out of the browser. Restrict it to the deployed domain in Mapbox.

The eight original HTML experiments are preserved locally in ignored `legacy-local/`. They are excluded from GitHub source and Pages output, including their old embedded tokens. `dist/` is generated and replaced on each build; it is not an archive. The root `index.html` is the application entry point.

## Rendering and dependency changes

The original already used WebGL through Mapbox and Three.js. The current app pins Mapbox GL JS **3.33.0**, Three.js **0.186.1**, and Vite **8.3.5**, with a reproducible pnpm lockfile. MapLibre has been removed.

* Mapbox retains the original custom dark style, Mercator projection, 45° starting pitch, and north-up bearing.
* The Polish **KIERUNKI WSTĘG** switch offers **Wspólna oś** and **Do celu 45° / auto** (default).
* Shared mode fits a least-squares principal axis to all incoming and outgoing neighbours, weighted by flow volume. This avoids cancellation when neighbours lie on opposite sides. The axis is oriented with the net travel direction, with a deterministic fallback for symmetric data. All departures use that axis; arrivals approach the opposite side.
* Target-facing mode jointly assigns distinct angular slots to every incoming and outgoing directed connection at each point. It minimizes total squared circular angular deviation from the target bearings; collisions are resolved by moving connections to nearby free slots. All transport types on one directed connection share its assigned angle and stay stacked. Reverse-direction connections to the same neighbour receive separate ports.
* The per-node grid uses 45° spacing for up to 8 connections, 30° for 9–12, and 15° for 13–24. Above 24 it continues subdividing (7.5°, 3.75°, etc.) rather than reusing angles. Assignment is deterministic regardless of input order. Shared-axis mode intentionally retains its common axis.
* Every ribbon has a 55 m flat neck at both endpoints (capped to 15% of the connection distance for very close points). In shared mode, every incoming band merges before the mast, and outgoing partitions remain together briefly after it. This replaces the previous origin-only exit correction and fixes the split-stack appearance at Trynek as well as Rynek.
* Between the necks, cubic Bézier handles extend half the endpoint distance along the selected bearings. There is no added sinusoidal vertical hump. Changing the angle switch rebuilds/caches the 3D plan geometry without changing any counts, mode heights, or mast positions.
* At each node, every transport mode occupies one shared contiguous vertical band, in car / bus / bicycle / pedestrian order. Incoming and outgoing partitions of the same mode share that band. For example, car directions of 200, 300, and 500 fill adjacent subintervals of one 1000-count car band; they do not repeat the full color stack at different levels.
* Each flow has equal thickness at both ends, using a common linear scale of **0.6 local metres per count**, twice the previous height scale. The demo circulation throughput is also doubled, so the 2000 mixed-mode movements at Rynek and Trynek now span 1200 metres (four times the previous 300 m height); modes remain separate in numerical summaries.
* At either end, directions fan vertically out of / into the correct shared mode band. Smooth C1 transitions in the outer quarters gather each direction into a compact bundle through the middle half. Plan curves follow the selected shared or snapped bearings. Each ribbon keeps its count-based thickness. The separation near junctions is the branching between node partitions and a route bundle; it is filled by other route partitions at the node itself.
* The whole 3D ribbon network starts at 30 metres and rises to at least 20 metres above the tallest recognized loaded building. Standard Mapbox building height fields and constant fill-extrusion heights are read on map idle; the plane never drops while panning. This targets the original custom fill-extrusion building style; arbitrary imported models or custom height expressions without standard height fields would need separate height extraction. The 2D geometry is not lifted. Node pillars remain anchored to the ground and extend 35 m above the lifted stacks.
* Name-only HTML labels are anchored at mast tips using Mapbox Marker altitude in 3D, with a local-to-Mercator height conversion for exact alignment. In the existing flat view they return to ground level. Labels track changes to the building-clearance elevation; counts remain in the sidebar and hover details.
* Node pillars mark the ground-to-stack height. 3D arrow caps have been removed; hover labels show direction. Arrowheads remain on the flat 2D map.
* Saturated, distinct transport colors are shared by both map views and all controls: car red `#ff3355`, bus blue `#3395ff`, bicycle green `#00e676`, pedestrian yellow `#ffce00`.

The Polish interface has one title, “Analiza ruchu w Gliwicach”. Sidebar controls explain drag-to-pan, wheel zoom, Ctrl-drag or right-button drag for rotation/pitch in 3D, and selecting flows/locations. View, bearing, transport, location, fit, and export controls are in the sidebar. Scale/data notes and the connection table are collapsible sidebar sections. The map keeps only location labels, hover information, and native Mapbox controls/attribution. Transport buttons use their mode colors prominently. Machine-readable OD field names and canonical units remain stable.

Inactive flows remain visible at 12% of their normal alpha, preserving their original RGB colors. A selected transport type or node emphasizes its flows; the table/export contains the selected subset. Inactive flows are excluded from picking. The clear button resets the selection.

The renderer batches ribbons into four meshes rather than creating separate meshes and edge objects for every flow. The 3D node pillars add one batched line draw. Filtering changes existing buffers and visibility; geometry is cached by view. There is no continuous repaint loop. Transform matrices are reused, and GPU resources are disposed on removal.

These are draw-call and scheduling improvements, not a measured FPS multiplier. `trafficDebug()` in the browser console exposes actual frame count, draw calls, triangles, trajectory point count, GPU geometry count, runtime versions, and selected filters. Once loading finishes, frame count should stay constant while the map is idle. Switching between both views should retain at most thirteen GPU geometries (two 3D bearing variants, the point-cloud view, and node pillars).

## Conserved demonstration data

The original node vectors do not specify measured OD movements and do not balance on their own. The demonstration is now a **closed circulation at all seven points**, with no unexplained origins or sinks.

1. Set the circulation throughput through Rynek to **1000 cars, 500 buses, 300 bicycles, and 200 pedestrians**. `TRAFFIC_MULTIPLIER = 2` preserves the increased demo volume.
2. For the original forward connections, distribute each point's arrivals between its outgoing connections, independently for each mode. Original destination vectors remain relative weights; largest-remainder rounding preserves integer counts.
3. A synthetic **Trynek → Rynek** return connection carries precisely the arriving totals: 1000 cars, 500 buses, 300 bicycles, and 200 pedestrians. It supplies all of Rynek's departures rather than leaving them unexplained.
4. Every point now has **In = Out for every mode**, including Rynek and Trynek. No new map point is needed. The network contains **11 directed connections and 44 mode-specific flow records**.
5. Generation makes one topological pass over the forward connections with the designated return link excluded, then appends that return link. It never repeatedly circulates and inflates counts. This construction supports the current synthetic graph; arbitrary additional cycles would need an explicit circulation model.

`validateConservation()` checks every node and mode and throws on an imbalance. It runs when the demo is constructed and loaded. `validateFlows()` independently validates flow records. Coordinates and place names are carried over without independent geocoding. The return connection is marked `circulationReturn: true` and identified in the UI/export as synthetic.

These counts are synthetic, not observations. The UI and JSON export say so. No observation period was supplied, so no hourly rate or date is invented. Cars and buses are assumed to be vehicles, cycling counts bicycles, and walking counts people; no bus occupancy is inferred. These mode units should be verified against any replacement dataset and are not added into a single numerical traffic total.

Network totals count movements over directed links, not unique travelers: a movement passing through multiple connections contributes once to each traversed connection. Location summaries show incoming and outgoing mode counts. The connection table and JSON export follow the current filters. Export metadata distinguishes a conserved full network from a selected point's incident-flow subset, which need not balance at the other endpoints.

For measured data, replace demo generation with validated records such as:

```js
{ id: 'rynek-arena-car', source: 'rynek', target: 'arena', mode: 'car', value: 240, estimated: false }
```

Supply the actual common observation period and units and update the demonstration notices. `validateFlows()` rejects duplicate IDs, unknown endpoints, self-loops, unknown modes, and nonpositive/noninteger counts. A measured open network may require explicit origins, destinations, or external connections to explain any imbalance; do not silently rescale real observations.

## 2D point-density view

The 2D tab now renders **Three.js Points**, rather than flat ribbons. Translucent, soft circular points lie along schematic straight OD connections. Their density is proportional to each mode's movement count. Small seeded lateral offsets separate transport colors and make a trajectory-like cloud; streams converge at their actual endpoints.

* 16 rendered points per movement for this demo, giving **130,768 points** across four batches/draw calls.
* A shared **250,000-point budget** bounds larger datasets, using proportional integer allocation across all flows without altering the underlying counts.
* Point size is 2.4 CSS pixels, adjusted to the shared canvas pixel ratio. Base alpha is 0.28; inactive streams use 12% of that alpha.
* Deterministic per-flow sampling prevents point positions from changing when filters are toggled. Geometry is generated once and cached; filtering updates only color alpha.
* Four point batches share one procedural soft-circle texture, disposed with the scene. There are no external image assets or animation timers.
* Hover picking checks route centerlines rather than raycasting every point. The same type/location controls and name labels work in both views. 2D labels stay at ground level.

These are synthetic movement-density traces, not GPS observations or road-following routes. Exact counts remain in tooltips and the sidebar because visual overlap saturates nonlinearly. No routing service was called and no animation has been added. [docs/2d-trajectories.md](docs/2d-trajectories.md) records the reference and future road-routing options.

## GitHub Pages

This client-only app can be hosted on GitHub Pages. Relative build asset paths and a pinned GitHub Actions deployment workflow are configured for the `fallenartist/traffic-vis` repository. See [docs/github-pages.md](docs/github-pages.md) for repository settings, Mapbox URL access, and deployment steps. The expected Pages URL is `https://fallenartist.github.io/traffic-vis/`; workflow runs and Pages settings determine deployment status.

## Verification

Twenty-one automated tests cover:

* Integer allocation, circulation throughput, and increased counts for every link/mode.
* Strict incoming/outgoing equality at all seven nodes, and rejection of imbalanced records.
* Explicit return-link totals and the 11-connection / 44-flow graph.
* Contiguous, nonoverlapping incoming/outgoing mode stacks and equal color extents at every point.
* Finite geometry, equal ribbon thickness, four batched mode meshes, and picking metadata in both bearing modes and the 2D point-cloud view.
* Ordered colors during vertical fan-out/fan-in and touching bands in the compact middle.
* Least-squares shared-axis fitting with opposite neighbours; unique assigned ports at every node, including Trynek; transport-type grouping; adaptive grids at 8/9/12/13/24/25/49 connections; deterministic assignment; and optimal total angular error against brute-force cases.
* Whole incoming and outgoing necks at every point, including Trynek and Rynek.
* Building clearance, mast headroom, label-tip height calculations, and elevation updates without drift.
* Proportional point-density sampling, a shared global point budget, deterministic geometry, endpoint alignment, and RGBA alpha for inactive ribbons and point streams.

The previous strict curve comparison to the original experiment has been replaced by bearing-specific tests because the new shared-axis and snapped-angle layouts intentionally change the plan curves. The original HTML files remain unchanged in the ignored local archive.

Production compilation validates the installed module imports and bundle entry. A production artifact check verified relative JS/CSS URLs resolve under a GitHub Pages repository subpath. Source/HTML checks verified the UI element references and single-title structure. The Pages workflow has not been run on GitHub. A separate static geometry rendering was inspected. Live browser visual QA and GPU/FPS measurements remain unverified because no connected browser was available in the computer-use environment.

Official references:

* [Mapbox custom Three.js layer](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)
* [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
* [Three.js resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)
* [deck.gl PathLayer](https://deck.gl/docs/api-reference/layers/path-layer)
* [deck.gl MapboxOverlay](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay)
