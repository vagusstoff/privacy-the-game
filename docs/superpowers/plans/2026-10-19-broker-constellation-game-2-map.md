# Broker Constellation, Phase 2, Plan 2: The constellation screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A star map of every broker in the dataset, reached from The Reclamation, lit from the player's progress, with a card for each star and a reach-weighted "field covered" header.

**Architecture:** A build script lays the stars out once, deterministically, over the dataset, and writes fixed coordinates to `src/data/broker-layout.json`. Phones never run a simulation. The game fetches `broker-map.json` and `broker-layout.json` the first time the map opens and keeps them in memory, so looking up a star makes no request. The map is one SVG string built by a pure function from the layout and Plan 1's `brokerLighting`. Selection, zoom and pan are in-memory only, and the route is one fixed hash.

**Tech Stack:** Node 22 for the layout script, vanilla JS ESM and SVG in the game, vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-broker-constellation-design.md`, Phase 2: "Where it lives", "What it shows", "Layout", "How stars light up" (residency), "Clicking a star", "Privacy", "Tests". Mockup: option A in `docs/superpowers/specs/assets/2026-10-18-broker-constellation-mockups.html` (aim at its look, not its positions).

**Plan order:** Plan 2 of 3. It needs Plan 1 (`2026-10-19-broker-constellation-game-1-filing.md`) merged, for `brokerLighting`, `fieldCoverage`, `fieldHeader`, `isBuyer`, `setResidency` and the saved-game fields. Plan 3 adds the Big Check, Scout's lines and the NAI/DAA member data.

## Global Constraints

- No new npm dependencies, runtime or dev. No runtime layout: positions come from a build script.
- `STATE_VERSION` stays `1`. Old saves never lose progress.
- **Broker ids, the selected star, residency and ticks never go in the URL.** The map's route is exactly `#/reclamation/map`. `app.js` sends `location.href` as every pageview.
- No new `track()` calls. The existing pageview (title `broker-map`) is the funnel signal.
- Every opt-out URL shown is one the dataset's checker marked `verified` (`optOut.status === 'verified'` with a `verifiedAt`). Every other URL shown is a source's `archived` Wayback copy, or one of the complaint URLs already in `tests/fixtures/verified-urls.json`.
- Colours: lime `#C6FF00` you filed; amber `#FF9F00` re-check due; magenta `#FF2D9B` ✕ no opt-out exists; dim `#3a4256` not yet. The NAI/DAA halo is never lime.
- Header: `FIELD COVERED: n% · HUBS LIT n/12`, with the sub-line `estimated share of the field your opt-outs reach`.
- Hubs (top 12 by reach) carry permanent labels. Other stars are labelled when tapped.
- Phone: 16px gutters, no horizontal scroll, readable at 375px. The test is 839 stars on a mid-range phone.
- Motion respects `prefers-reduced-motion` (colours stay, motion stops), as `city-lights.js` does.
- Every PR bumps the version.

## Review Focus

1. **`broker-map.json` and `broker-layout.json` cached from different releases** (the service worker serves cache first, then refreshes). Expected: stars missing from either file are skipped, and nothing throws. Pinned by Task 3's `stars missing from the layout or the map are skipped`.
2. **The first map open is offline, or the fetch fails.** Expected: a "couldn't load the map" panel with a retry, the rest of the game is unaffected, and the error is reported once. Pinned by Task 2's `a failed load shows the error panel`.
3. **A tap on empty sky, far from any star.** Expected: no selection and no error. At zoom 1 the view zooms in on that point. Pinned by Task 5's `nearestStar is null beyond maxDist`.
4. **Selection or zoom leaking into the URL.** Expected: the hash stays `#/reclamation/map`, and every `href` on the screen is the district, a mission briefing, a verified opt-out URL, an archived source or a complaint form. Pinned by Task 5's `every href on the map screen is allowed`.
5. **A hub with a long legal name at 375px** (`TransUnion Risk and Alternative Data Solutions, Inc.`). Expected: labels use the short name and the card wraps without horizontal scroll. Pinned by Task 3's `hub labels use the short name` and Task 6's scroll-width check.

---

## File Structure

```
research/data-brokers/build/layout.js   computeLayout(map, sizeKnown) + CLI → src/data/broker-layout.json
research/data-brokers/build/export.js   adds brokers[].sources (non-registry, {url, archived, kind})
src/data/broker-layout.json             generated
src/utils/broker-data.js                loadBrokerData(), brokerDataStatus(), resetBrokerData()
src/utils/broker-view.js                nearestStar, zoomView, shortName, whatsLeft
src/components/constellation.js         constellationSvg(...)
src/components/star-card.js             starCard(...)
src/screens/broker-map.js               renderBrokerMap(state, opts)
src/router.js, src/app.js               route + actions
src/screens/district.js                 "SEE THE WHOLE FIELD" entry on The Reclamation
src/utils/broker-state.js               markMapSeen(state, litIds)
tests/broker-data/layout.test.js, tests/broker-game/*.test.js
```

---

### Task 1: Build-time layout

**Files:**
- Create: `research/data-brokers/build/layout.js`, `src/data/broker-layout.json` (generated)
- Modify: `package.json` scripts (`"brokers:layout": "node research/data-brokers/build/layout.js"`), `research/data-brokers/README.md` (add step 7 under "How to rebuild" and a "Layout" paragraph)
- Test: `tests/broker-data/layout.test.js`

**Interfaces:**
- Produces:
  - `computeLayout(map, sizeKnown: Set<string>) → { formatVersion: 1, asOf: string, size: 1000, stars: Array<[id, x, y, r]> }`, with `stars` sorted by id and numbers rounded to 1 decimal. The CLI reads `src/data/broker-map.json` and `research/data-brokers/brokers/*.json` (for `size.known`), writes the file with `JSON.stringify(out)` (one line), and prints the byte size.
  - Radius: `r = 2 + 2.2 * log2(reach) + (sizeKnown ? 1 : 0)`. A broker of unknown size gets no size term.
  - Placement in a 1000×1000 square centred on (500, 500):
    - **Buyers** (`kind` includes `buyer`) sit on the rim, radius 470, evenly spaced in id order, starting at -90°.
    - **Linked non-buyers** (in any published link) are placed by Fruchterman–Reingold inside radius 330:
      - seeded PRNG mulberry32(`20261018`) for start positions
      - 400 iterations, `k = sqrt(π·330² / n)`, temperature cooling linearly from 60 to 0.5
      - buyers take part in attraction as fixed anchors but never move
      - then up to 200 push passes so no two hubs are closer than 140
      - positions are clamped to radius 330
    - **Unlinked non-buyers** fill the annulus 350–440, in id order: `angle = i × 2.39996`, `radius = 350 + 90 × sqrt((i + 0.5) / N)`. These are the brokers with no documented links, at the outer edge.

- [ ] **Step 1: Write the failing tests**

```js
it('is byte-identical across two runs', ...);
it('every broker has exactly one star', ...);
it('buyers sit on the rim', () => { for (const [id, x, y] of buyers) expect(Math.abs(Math.hypot(x - 500, y - 500) - 470)).toBeLessThan(0.6); });
it('unlinked brokers sit in the outer annulus', ...);     // 349.5 ≤ d ≤ 440.5
it('linked brokers sit inside 330', ...);
it('no two hubs are closer than 140', ...);
it('radius follows reach and known size', () => {
  // synthetic map: reach 1 unknown → 2; reach 4 with size known → 7.4; reach 18 unknown → 11.2
});
it('the committed layout matches the committed map', () => {
  // src/data/broker-layout.json: asOf === broker-map.json asOf; star ids === broker ids
});
```

- [ ] **Step 2: Run `npx vitest run tests/broker-data/layout.test.js` and confirm it fails.**
- [ ] **Step 3: Implement `layout.js`, then run `npm run brokers:layout`.** Expected: the file is written, and it's under 60 KB.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(data-brokers): build-time constellation layout`

### Task 2: Sources on the export, the data loader and the route

**Files:**
- Modify: `research/data-brokers/build/export.js`, `src/data/broker-map.json` (regenerated), `research/data-brokers/README.md` (export table gains `brokers[].sources`), `src/router.js`, `src/app.js`
- Create: `src/utils/broker-data.js`, `src/screens/broker-map.js` (shell: loading, error, and the loaded view from Task 4)
- Test: `tests/broker-data/export.test.js` (extend), `tests/broker-game/route-and-data.test.js`, `tests/sw.test.js` (extend)

**Interfaces:**
- Produces:
  - Each export broker gains `sources: Array<{ url, archived, kind }>`: the record's sources whose kind isn't `registry`, sorted by `url`. Each is `[]` when there are none. `formatVersion` stays `1`, since the field is additive.
  - `parseRoute('#/reclamation/map') → { screen: 'broker-map', params: {} }`. No other `#/reclamation/...` form is accepted (`#/reclamation/map/x` → city).
  - `loadBrokerData(fetchImpl = fetch) → Promise<{ map, layout }>`. It fetches `data/broker-map.json` and `data/broker-layout.json` (relative, so the SW caches them), and memoises the promise. A failure rejects, reports via `captureError` once, and clears the memo so a retry can refetch.
  - `brokerDataStatus() → 'idle' | 'loading' | 'ready' | 'error'`, `brokerData() → { map, layout } | null`, `resetBrokerData()` (tests).
  - `app.js` adds the screen `'broker-map': () => renderBrokerMap(state, { status: brokerDataStatus(), data: brokerData(), selectedId, view, newlyLit })` (the last three are in-memory variables in `app.js`). While idle it calls `loadBrokerData().then(() => renderCurrentRoute(), () => renderCurrentRoute())` (REFRESH, not a pageview). The action `retry-broker-data` does the same.
  - `renderBrokerMap` while loading shows `LOADING THE FIELD…`. On error it shows `COULDN'T LOAD THE MAP` with `<button data-action="retry-broker-data">TRY AGAIN</button>` and `← THE RECLAMATION` (`#/district/reclamation`).

- [ ] **Step 1: Write the failing tests**

```js
it('export gives each broker its non-registry sources', ...);  // a fixture dataset; registry source absent; sorted
it('the route is one fixed hash', () => {
  expect(parseRoute('#/reclamation/map')).toEqual({ screen: 'broker-map', params: {} });
  expect(parseRoute('#/reclamation/map/spokeo').screen).toBe('city');
  expect(parseRoute('#/reclamation/map?star=spokeo').screen).toBe('city');
});
it('loadBrokerData fetches both files once', ...);              // fake fetch counts 2 calls across two loads
it('a failed load shows the error panel', ...);                  // status 'error' → HTML has COULDN'T LOAD THE MAP and data-action="retry-broker-data"
it('the service worker caches the data files', () => {
  expect(shouldIntercept(new URL('https://x.test/reclaim-city/data/broker-map.json'))).toBe(true);
  expect(shouldIntercept(new URL('https://x.test/reclaim-city/data/broker-layout.json'))).toBe(true);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Run `npm run brokers:export` and then `npm run brokers:layout`, and commit both generated files.
- [ ] **Step 4: Run `npx vitest run tests/broker-data tests/broker-game tests/router.test.js tests/sw.test.js tests/pageview.test.js`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): route, data loader, sources on the export`

### Task 3: The constellation SVG

**Files:**
- Create: `src/components/constellation.js`, `src/utils/broker-view.js` (`shortName` here)
- Test: `tests/broker-game/constellation.test.js`

**Interfaces:**
- Consumes: `Lighting` and `isBuyer` (Plan 1, `src/utils/broker-lighting.js`).
- Produces:
  - `shortName(name: string) → string`. It strips a trailing comma or legal suffix (`Inc.`, `Inc`, `LLC`, `L.L.C.`, `Ltd`, `plc`, `PLC`, `Corp`, `Corporation`, `Company`, `Co.`), once. `Experian plc` gives `Experian`; `TransUnion Risk and Alternative Data Solutions, Inc.` gives `TransUnion Risk and Alternative Data Solutions`.
  - `constellationSvg({ map, layout, lighting, selectedId = null, newlyLit = new Set(), view = { x: 0, y: 0, w: 1000 } }) → string`. It returns `<svg class="constellation" viewBox="x y w w" role="img" aria-label="Map of data brokers: …">`, with these layers in order:
    - **Links:** `<line class="link">`, opacity `min(0.6, 0.15 × (1 + sources.length))`; tier C gets `stroke-dasharray` (none ship yet).
    - **Stars:** `<circle class="star star--lit|star--amber|star--dim">`. A `no-opt-out` star is a magenta ✕ `<path class="star-x">`. A buyer is a hollow diamond `<rect class="buyer">` stroked `#8a93a6`.
    - **Rings and halos:** a frozen star gets `<circle class="ring-frozen">` (cyan, dashed) at `r + 3`. A halo star gets `<circle class="halo">` at `r + 4`, filled `#EDEFF3` at opacity 0.12.
    - **Effects:** a newly lit star gets class `star--new`, with an `animation-delay` of `(i % 20) × 60ms` in id order. The selected star gets `<circle class="selected">`.
    - **Labels:** `<text class="hub-label">${shortName(name)}</text>` for hubs.
    - **Styles:** a `<style>` block with the bloom keyframes, inside `@media (prefers-reduced-motion: no-preference)`.
    - No `href`, no `<a>`, and no broker id in any attribute (ids stay in the layout arrays the app reads).
  - A star in the layout but not the map, or the other way round, is skipped.

- [ ] **Step 1: Write the failing tests** (mini map from Plan 1's fixture, plus a matching mini layout)

```js
it('draws one mark per laid-out broker', ...);           // circles + ✕ + diamonds === 12
it('lit, amber and dim stars get their class', ...);
it('a no-opt-out star is a magenta ✕', ...);
it('a buyer is a diamond', ...);
it('a frozen star gets the frozen ring', ...);
it('a halo is never lime', () => expect(svg.match(/<circle class="halo"[^>]*>/g).join('')).not.toMatch(/C6FF00/i));
it('newly lit stars bloom', ...);
it('stars missing from the layout or the map are skipped', ...);
it('hub labels use the short name', ...);
it('the SVG carries no links and no broker ids', () => { expect(svg).not.toMatch(/href=|<a\b/); expect(svg).not.toMatch(/spokeo/); });
it('renders the real map in under 200ms in node', ...);  // 839 stars; a guard against accidental quadratic work
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/constellation.test.js` and confirm it fails.**
- [ ] **Step 3: Implement.** Hub labels sit to the right of the star, at 22 units in the 1000-unit space. Lines draw under the stars.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): constellation SVG`

### Task 4: The map screen, residency, and the way in

**Files:**
- Modify: `src/screens/broker-map.js` (loaded view), `src/screens/district.js`, `src/app.js`, `src/utils/broker-state.js` (`markMapSeen`), `src/utils/broker-view.js` (`whatsLeft`), `src/data/dialogue.js` (`BROKER_MAP_DIALOGUE.nudge` and `.dropNotResident` only; Plan 3 adds the rest)
- Test: `tests/broker-game/map-screen.test.js`

**Interfaces:**
- Consumes: `brokerLighting`, `fieldCoverage`, `fieldHeader`, `setResidency` (Plan 1); `constellationSvg` (Task 3).
- Produces:
  - `markMapSeen(state, litIds: string[]) → state` sets `state.brokerMap.seenLit` (sorted). A save whose `brokerMap` isn't a plain object starts it fresh. `cleanBrokerState` (Plan 1) also drops a non-object `brokerMap` and a non-array `seenLit`. `newlyLit` = lit ids not in `seenLit`; a first visit (no `seenLit`) treats every lit star as new. `app.js` computes `newlyLit` before the NAVIGATE render and calls `markMapSeen` after it. A REFRESH render passes an empty set.
  - `whatsLeft(map, lighting, n = 5) → Array<{ id, name, reach, mission: string | null }>`: reachable, unlit, non-buyer stars by reach descending, then id. `mission` is the first non-recon id in `missions`, else `null`.
  - `renderBrokerMap(state, { status, data, today = localDay(), selectedId, view, newlyLit })`, top to bottom:
    - **Back link:** `← THE RECLAMATION`.
    - **Header:** `fieldHeader(...)` and the sub-line `estimated share of the field your opt-outs reach`.
    - **The SVG**, with zoom buttons `data-action="map-zoom" data-dir="in|out"`.
    - **Legend:** lime `You filed` · amber `Re-check due` · magenta ✕ `No opt-out exists` · dim `Not yet` · ring `Credit frozen (still sells data)` · halo `Opted out in this browser only` · diamond `Buyers`.
    - **Pending nudge:** when `lighting.pending` is non-empty, `BROKER_MAP_DIALOGUE.nudge` (`Tell Scout which ones you filed.`) with one link per pending mission to `#/mission/<id>/debrief`.
    - **Residency:**
      - While `caResident` is unset, it asks `Do you live in California?` with `data-action="set-residency" data-value="yes|no|unsaid"`, labelled `Yes`, `No`, `Rather not say`.
      - Once answered, it shows `California resident: Yes|No|Rather not say` and a `CHANGE` button (`data-action="change-residency"`), which shows the three buttons again from in-memory state.
    - **DROP card,** by `lighting.drop`:
      - `lit`: `DROP: filed. It lights the brokers registered in California.`
      - `not-resident`: `BROKER_MAP_DIALOGUE.dropNotResident`
      - `ask`: `DROP: filed. Tell the map whether you live in California to light it.`
      - `off`: `DROP: not filed yet.`, with a link to `#/mission/people_search-reclaim-stragglers/briefing`
    - **What's left:** `WHAT'S LEFT THAT MATTERS`, listing `whatsLeft` rows as `name · reach n`. Each row links to its mission briefing, or reads `No mission covers this one yet` (Plan 3 turns that into a Big Check link).
  - `dropNotResident` (exact copy): `DROP is only for California residents, so it doesn't light anything for you. Your other opt-outs still do.`
  - `renderDistrict(state, 'reclamation', …)` gets a panel above the tabs: `SEE THE WHOLE FIELD` linking to `#/reclamation/map`, with the line `Every data broker we could find, and which ones your opt-outs reach.` No other district gets it.
  - `app.js` actions: `set-residency` (`setState(setResidency(...))` then REFRESH), `change-residency`. No `track()`.

- [ ] **Step 1: Write the failing tests** (real map and layout)

```js
it('a new player sees 0% and 0/12', () => expect(html).toContain('FIELD COVERED: 0% · HUBS LIT 0/12'));
it('labels the number as an estimate', () => expect(html).toContain('estimated share of the field your opt-outs reach'));
it('asks residency once, with three answers', ...);
it('an answered residency shows the answer and CHANGE', ...);
it.each([['no'], ['unsaid']])('DROP explains why it lights nothing for %s', ...);
it('the pending nudge links each pending mission\'s debrief', ...);
it('whatsLeft on a new save is the top five by reach', () =>
  expect(whatsLeft(map, brokerLighting(map, {}, '2026-10-19')).map((r) => r.id)).toEqual(['transunion', 'experian', 'relx-plc', 'general-motors', 'equifax']));
it('first visit blooms every lit star; the next visit blooms none', ...);  // markMapSeen
it('only The Reclamation links to the map', ...);
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/map-screen.test.js` and confirm it fails.**
- [ ] **Step 3: Implement.** Layout follows `debrief.js`: 16px side padding at narrow widths, and the SVG at `width: 100%; height: auto`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): the map screen, residency, and the way in`

### Task 5: Tapping a star, the card, zoom and pan

**Files:**
- Create: `src/components/star-card.js`
- Modify: `src/utils/broker-view.js` (`nearestStar`, `zoomView`), `src/screens/broker-map.js`, `src/app.js`
- Test: `tests/broker-game/star-card.test.js`

**Interfaces:**
- Produces:
  - `nearestStar(layout, x, y, maxDist) → id | null`, in layout units.
  - `zoomView(view, dir: 'in' | 'out', cx = view.x + view.w / 2, cy = view.y + view.w / 2) → view`. Widths step 1000 → 500 → 250 and back, centred on (cx, cy) and clamped inside 0–1000.
  - `starCard(map, lighting, id) → string`:
    - **Name and parent:** `shortName` heading, then the full name, then `Part of <parent name>` when `parent`.
    - **What it sells:** `sells`, under the label `WHAT ITS RECORDS SAY IT SELLS`.
    - **Documented links:** every published link touching it, as `Owns`, `Owned by`, `Supplies`, `Supplied by`, `Buys from` or `Sells to`, plus the other party's `shortName`, the `claim`, and an `archived` source link per source.
    - **Sources:** the record's `sources`, under the label `SOURCES`, as `archived` links.
    - **Opt-out:**
      - `verified`: `<a href="<url>" target="_blank" rel="noopener noreferrer">OPT OUT ↗</a>`, plus `optOut.email` as text when present.
      - Any other status: `We couldn't confirm their opt-out page when we last checked (<verifiedAt>).`
      - `null`: `We don't know an opt-out route for this one yet.`
      - `none`: `No opt-out exists.`, then `What you can do instead: file a complaint, so it's on the record.` with links to `https://cppa.ca.gov/webapplications/complaint` (`California Privacy Protection Agency`) and `https://reportfraud.ftc.gov/` (`FTC`).
    - **Frozen:** `Your credit is frozen here. A freeze stops new credit in your name; it doesn't stop this company selling what it holds.`
    - **Halo:** `You opted out in this browser through the NAI or DAA tool. That sets a cookie on this device; it deletes nothing.`
    - **Coverage:** `COVERED BY` plus a link per non-recon mission to `#/mission/<id>/briefing`, titled with `mission.title`. Plan 3 adds the Big Check tick here when there is none.
    - **Close:** `<button data-action="close-star">CLOSE</button>`.
  - `app.js`: a click inside `.constellation` maps the pointer through `svg.getScreenCTM().inverse()`. It calls `nearestStar` with `maxDist = 24 css px` converted to layout units. A hit sets the in-memory `selectedStar` and re-renders (REFRESH). A miss at full width zooms in on that point. `map-zoom` and pointer-drag pan update the in-memory `mapView`; a drag writes the `viewBox` attribute directly, without re-rendering. Nothing calls `navigate`, `track` or `history`.

- [ ] **Step 1: Write the failing tests**

```js
it('nearestStar finds the closest star within maxDist', ...);
it('nearestStar is null beyond maxDist', ...);
it('zoomView steps and clamps', () => {
  expect(zoomView({ x: 0, y: 0, w: 1000 }, 'in', 10, 10)).toEqual({ x: 0, y: 0, w: 500 });
  expect(zoomView({ x: 0, y: 0, w: 1000 }, 'out')).toEqual({ x: 0, y: 0, w: 1000 });
});
it('a verified opt-out is a link; any other status is not', ...);
it('a no-opt-out card offers the complaint forms', ...);
it('every opt-out URL any card shows is verified', () => {
  for (const b of map.brokers) for (const u of optOutHrefs(starCard(map, l, b.id))) expect(b.optOut?.url === u && b.optOut.status === 'verified').toBe(true);
});
it('every external link on a card is a verified opt-out, an archived source or a complaint form in verified-urls.json', ...);
it('every href on the map screen is allowed', () => {
  // renderBrokerMap with selectedId = 'spokeo': each href matches
  // ^#/(district/reclamation|reclamation/map|mission/[^/]+/(briefing|debrief))$ or the external rule above
});
it('a card lists its links and their archived sources', ...);    // e.g. 'avast' → Owns Jumpshot … web.archive.org
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/star-card.test.js` and confirm it fails.**
- [ ] **Step 3: Implement.** The card sits below the map at phone width and beside it from 900px. Text uses `overflow-wrap: anywhere`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): star card, zoom and pan`

### Task 6: Phone check, version, PR

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `docs/screenshots/broker-constellation/*.png`

- [ ] **Step 1: Run the full suite** with `npx vitest run` (or `~/.claude/bin/vast-test`). Expected: every test passes.
- [ ] **Step 2: Check it in a real browser** (Playwright MCP, `npm run dev`, viewport 375×812):
  - Open `#/district/reclamation`, then SEE THE WHOLE FIELD.
  - Expected: `document.documentElement.scrollWidth <= 375` on the map, with a card open, and zoomed in.
  - Expected: the hash is still `#/reclamation/map` after a tap, a zoom and a residency answer.
  - Expected: with CPU throttled 4× (CDP `Emulation.setCPUThrottlingRate`), the map's first render finishes in under 1000 ms.
  - Expected: with reduced motion emulated, nothing animates.
  - Screenshot each state, plus a seeded save with legacy filings and DROP lit.
- [ ] **Step 3: Bump the version** with `npm version minor --no-git-tag-version`.
- [ ] **Step 4: Commit by explicit paths, push, and open a PR** with the screenshots. Merge once the full suite is green.

## Open questions for Liz (the plan uses the default shown until she answers)

1. **Opt-out pages the checker couldn't confirm.** 75 records are `blocked` (usually bot protection, not a dead page), 15 are `suspect` and 20 are `dead`. Default: only `verified` URLs are shown as links. The others say `We couldn't confirm their opt-out page when we last checked`, which keeps the v5.0 rule that every URL shown was live-checked. The alternative is to also link `blocked` pages, labelled as unconfirmed.
2. **The spec's Tests section says card URLs must be in `tests/fixtures/verified-urls.json`.** Its Phase 1 section ("URL checking at this scale") says the dataset's own checker replaces that file for broker URLs. Default: follow Phase 1 (`optOut.status === 'verified'`). Only the two complaint forms, which missions already use, come from `verified-urls.json`.
