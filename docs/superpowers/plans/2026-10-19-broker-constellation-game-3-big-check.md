# Broker Constellation, Phase 2, Plan 3: The Big Check, Scout, and the NAI/DAA halo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A completionist checklist of every broker the player's missions and sweeps don't reach, Scout's lines for the map, and the published NAI/DAA member lists that give ad-network stars their "this browser only" halo.

**Architecture:** NAI and DAA membership is added to the dataset the same way as everything else: sourced, archived, validated, and exported as a `sweeps` block in `broker-map.json`. Plan 1's lighting already reads `map.sweeps?.[s]?.members`. The Big Check is a second fixed-hash screen built from the same lighting. Scout's map lines live in `dialogue.js` with the other lines, and are shown once each, tracked by flags in the saved game.

**Tech Stack:** Node 22 dataset scripts, vanilla JS ESM, vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-broker-constellation-design.md`, Phase 2: "The Big Check", "Scout", "How stars light up" (NAI/DAA), "Clicking a star" (the Big Check tick), "Privacy".

**Plan order:** Plan 3 of 3. It needs Plan 1 (`…-game-1-filing.md`) and Plan 2 (`…-game-2-map.md`) merged.

## Global Constraints

- No new npm dependencies, runtime or dev.
- `STATE_VERSION` stays `1`. Old saves never lose progress.
- The Big Check is optional. It never blocks district completion, city lights or anything else, and never counts toward the collective score. Ticks live in the saved game only.
- Nothing per-broker goes through `track()` or the URL. The Big Check's route is exactly `#/reclamation/big-check`.
- NAI/DAA give a faint "this browser only" halo, never lime, and light no star.
- Dataset rules from Phase 1: every source has a `url`, a Wayback `archived` copy and an `accessed` date; nothing is added without a source; unknown stays unknown.
- Scout's lines follow the `dialogue.js` rules:
  - no claim we can't verify
  - no number we can't source (these lines carry no digits at all)
  - none of the phrases banned in `tests/recon-phase3-districts.test.js`
  - added to `docs/scout-dialogue-ch8-reclamation.md` as well
- Opt-out links follow Plan 2's rule: only `verified` URLs are links.
- Every PR bumps the version.

## Review Focus

1. **A Big Check tick on a broker that a later dataset release puts in a mission.** Expected: the tick stays recorded and the star stays lit, and the row shows the mission instead of a tick box. Pinned by Task 2's `a ticked broker that gains a mission stays lit`.
2. **About 700 rows on a phone, filtered to nothing.** Expected: `No brokers match`, and clearing the filter restores the groups. Pinned by Task 2's `filtering to nothing says so`.
3. **Scout's one-time lines after a reload.** Expected: each line shows once per save, never twice. Pinned by Task 3's `each map line shows once`.
4. **A member list naming a company under a different spelling** (`Criteo SA` vs. the record `criteo`). Expected: one record, matched by legal name; a match on brand alone is never made. Pinned by Task 1's `members match records by legal name only`.
5. **Ticks reaching progress or the collective.** Expected: `calcDistrictProgress`, `calcIntegrity` and `restoreEvents` are identical with and without `bigCheck`. Pinned by Task 2's `Big Check ticks count for nothing but the map`.

---

## File Structure

```
research/data-brokers/build/sweeps.json      NAI/DAA member lists (source of truth)
research/data-brokers/build/schema.js        source kind member-list; validateSweeps
research/data-brokers/build/validate.js      runs validateSweeps
research/data-brokers/build/export.js        writes sweeps into broker-map.json
research/data-brokers/staging/membership/    member companies with no record yet (merged by merge-staging.js)
src/utils/big-check.js                       bigCheckGroups, filterBigCheck
src/screens/big-check.js                     renderBigCheck
src/components/star-card.js                  Big Check tick on cards with no mission
src/utils/broker-scout.js                    mapScoutLine, MAP_SCOUT_KEYS
src/utils/broker-state.js                    markScoutSeen
src/data/dialogue.js                         BROKER_MAP_DIALOGUE (rest of the lines)
docs/scout-dialogue-ch8-reclamation.md       the same lines, documented
```

---

### Task 1: NAI and DAA member lists in the dataset

**Files:**
- Create: `research/data-brokers/build/sweeps.json`, `research/data-brokers/staging/membership/…`
- Modify: `research/data-brokers/build/schema.js`, `validate.js`, `export.js`, `sources.json`, `brokers/*.json` (via merge), `src/data/broker-map.json` and `src/data/broker-layout.json` (regenerated), `research/data-brokers/README.md` (a "Sweeps" section, the new source kind, new counts and a new `asOf`)
- Test: `tests/broker-data/sweeps.test.js`

**Interfaces:**
- Produces:
  - `sweeps.json`: `{ "nai": { "name": "NAI opt-out tool", "source": "<source id>", "members": ["<broker id>", …] }, "daa": { "name": "DAA WebChoices", … } }`, with members sorted.
  - The source kind `member-list` is added to the schema's source kinds. It is never a tier A kind, so it can never back a published link.
  - `validateSweeps(sweeps, { brokerIds: Set, sources }) → string[]`. Errors: an unknown member id, a duplicate member, a missing source, a source whose kind isn't `member-list`, or a sweep id other than `nai` and `daa`.
  - The export adds `sweeps: { nai: { name, source: { url, archived }, members }, daa: { … } }`. `formatVersion` stays `1` (additive), and a reader treats a missing `sweeps` as `{}`.

- [ ] **Step 1: Write the failing tests**:
  - `validateSweeps rejects unknown members`
  - `validateSweeps rejects a non-member-list source`
  - `member-list is not a tier A kind`
  - `members match records by legal name only` (a fixture member `Criteo SA` merges into `criteo` through `normalizeName`; a fixture brand-only match stays unmatched and lands in staging)
  - `export writes sweeps with archived sources`
  - `export without sweeps.json writes no sweeps key`
- [ ] **Step 2: Run `npx vitest run tests/broker-data/sweeps.test.js` and confirm it fails.**
- [ ] **Step 3: Implement the schema, validator and export changes.**
- [ ] **Step 4: Gather the lists.** Find the NAI's and the DAA's own published member or participating-company pages. Save each to the Wayback Machine. Add each to `sources.json` as kind `member-list` with `accessed`. Match each company to a record by legal name, using the same rule as `merge-staging.js`. Write unmatched companies to `staging/membership/` as new records: `kind: ["ad-network"]`, `registries: {}`, `optOut: null`, `size: { known: false, signals: [] }`, and the list as their source. Run `node research/data-brokers/build/merge-staging.js membership`, review its rejected list by hand, then fill `sweeps.json`.
- [ ] **Step 5: Run `npm run brokers:validate`, `npm run brokers:export` and `npm run brokers:layout`, then the tests.** Expected: the validator exits 0, the tests pass, and Plan 2's `the committed layout matches the committed map` still passes.
- [ ] **Step 6: Commit**: `data(data-brokers): NAI and DAA member lists (<n> members, <m> new records)`

### Task 2: The Big Check

**Files:**
- Create: `src/utils/big-check.js`, `src/screens/big-check.js`
- Modify: `src/router.js`, `src/app.js`, `src/components/star-card.js`, `src/screens/broker-map.js` (a `THE BIG CHECK →` link, and What's-left rows with no mission link to it)
- Test: `tests/broker-game/big-check.test.js`

**Interfaces:**
- Consumes: `brokerLighting`, `isBuyer`, `setBigCheck` (Plan 1); `starCard` and its opt-out block (Plan 2).
- Produces:
  - `parseRoute('#/reclamation/big-check') → { screen: 'big-check', params: {} }`
  - `bigCheckGroups(map, lighting) → Array<{ kind: string, label: string, rows: Array<{ id, name, mission: string | null, ticked: boolean }> }>`:
    - **Rows:** every broker that isn't a buyer, has `optOut?.method !== 'none'`, and is not lit by any source except `big-check`. `ticked` means `via` includes `big-check`.
    - **Grouping:** by the first `kind`, in this order and with these labels: `people-search` People search, `marketing` Marketing, `risk-identity` Risk and identity, `location` Location, `financial` Financial, `health` Health, `automotive` Automotive, `identity-resolution` Identity resolution, `data-marketplace` Data marketplaces, `ad-network` Ad networks, then `''` Not yet classified.
    - **Order:** rows by `name`. Empty groups are dropped.
  - `filterBigCheck(groups, query) → groups`: a case-insensitive substring match on `name`; an empty query returns `groups`.
  - `renderBigCheck(state, { status, data, today })`:
    - Loading and error states reuse Plan 2's.
    - Heading `THE BIG CHECK`, then the line `Optional. It never counts toward your districts, your city lights or the city's totals.`
    - A filter `<input type="search" data-big-check-filter>`, whose `input` handler hides rows in place and re-renders nothing.
    - One `<details>` per group, its summary reading `<label> · <ticked>/<rows>`.
    - Each row: the name; the opt-out block (verified link or note); then either `<input type="checkbox" data-big-check="<id>">` labelled `I filed with them` (no mission) or `In a mission:` plus the mission briefing link.
    - `No brokers match` when the filter leaves nothing.
  - `starCard` adds the same tick box when the broker has no non-recon mission, isn't a buyer, and its method isn't `none`.
  - `app.js` handles `change` on `[data-big-check]` with `setState(setBigCheck(state, id, checked, localDay()))`. The Big Check screen does not re-render (so scroll and open groups stay). The map does a REFRESH render, so the star lights. No `track()`.

- [ ] **Step 1: Write the failing tests**

```js
it('the route is one fixed hash', ...);
it('rows exclude buyers, no-opt-out brokers and anything already lit', ...);  // mini map: us-ice, nope absent; spokeo absent once its checklist line is dated
it('DROP-lit brokers leave the list', ...);
it('a broker with a mission shows the mission, not a tick box', ...);
it('a ticked broker that gains a mission stays lit', ...);
it('unclassified brokers group last as Not yet classified', ...);
it('filtering to nothing says so', ...);
it('Big Check ticks count for nothing but the map', () => {
  // calcDistrictProgress for every district, calcIntegrity, restoreEvents: identical with and without bigCheck
});
it('the Big Check screen links nowhere but missions, the map and verified opt-outs', ...);
it('a long-tail card has the tick box; a mission broker\'s card does not', ...);
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/big-check.test.js` and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again plus `npx vitest run tests/broker-game`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): the Big Check`

### Task 3: Scout on the map

**Files:**
- Create: `src/utils/broker-scout.js`
- Modify: `src/data/dialogue.js`, `docs/scout-dialogue-ch8-reclamation.md`, `src/utils/broker-state.js` (`markScoutSeen`), `src/screens/broker-map.js`, `src/screens/big-check.js`, `src/components/star-card.js`, `src/app.js`
- Test: `tests/broker-game/scout-map.test.js`

**Interfaces:**
- Produces:
  - `BROKER_MAP_DIALOGUE` adds these lines (exact copy). `nudge` and `dropNotResident` are already there from Plan 2.
    - `opened`: `This is the whole field, as far as the public record goes. Every star is a company on a state data broker registry, or one that public documents tie to them. The big ones are big because of what the records show them owning, supplying or selling to, not because we guessed. The shapes on the rim are the buyers the contract records show paying for it. Dim means not yet. Lime means you filed.`
    - `firstHub`: `That's a hub. A lot of the documented lines run through it, so it counts for more of the field than a small site does.`
    - `sweep`: `One request, a whole cluster lit. That's DROP: every broker registered in California has to process it.`
    - `noOptOut`: `Some of them don't let you leave. When there's no opt-out, a complaint to a regulator still puts it on the record.`
    - `bigCheck`: `This is the long tail: every broker on the map that none of your missions reaches. It's optional, and it never counts toward your districts, your city lights or the city's totals. It's here for when you want to finish the job.`
  - `MAP_SCOUT_KEYS = ['opened', 'firstHub', 'sweep', 'noOptOut', 'bigCheck']`
  - `markScoutSeen(state, key) → state` sets `state.brokerMap.scout[key] = 1`.
  - `mapScoutLine(state, map, lighting, newlyLit: Set) → { key, line } | null`. The first unseen of:
    - `opened`
    - `firstHub` (some newly lit star is a hub)
    - `sweep` (10 or more newly lit stars have `drop` in `via`)
  - Event lines:
    - `noOptOut` shows on the first card opened for a `no-opt-out` star.
    - `bigCheck` shows on the first Big Check visit.
  - Each shows in Scout's bubble (the `scout_0.png` sprite and italic line, as in the debrief). `app.js` calls `markScoutSeen` after the NAVIGATE render that showed it, or after the card render for `noOptOut`.

- [ ] **Step 1: Write the failing tests**

```js
it('the map lines carry no digits', () => { for (const l of Object.values(BROKER_MAP_DIALOGUE)) expect(l).not.toMatch(/\d/); });
it('the no-opt-out line starts with the spec\'s sentence', () => expect(BROKER_MAP_DIALOGUE.noOptOut.startsWith("Some of them don't let you leave.")).toBe(true));
it('the nudge is the spec\'s sentence', () => expect(BROKER_MAP_DIALOGUE.nudge).toBe('Tell Scout which ones you filed.'));
it('first open shows the opened line', ...);
it('a newly lit hub shows firstHub after opened is seen', ...);
it('ten or more DROP-lit stars show sweep; nine do not', ...);
it('each map line shows once', ...);  // after markScoutSeen, a reloaded save (JSON round-trip) gives null
it('every line is documented in the chapter 8 dialogue doc', () => {
  const doc = readFileSync('docs/scout-dialogue-ch8-reclamation.md', 'utf8');
  for (const l of Object.values(BROKER_MAP_DIALOGUE)) expect(doc).toContain(l);
});
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/scout-map.test.js` and confirm it fails.**
- [ ] **Step 3: Implement, and add a "Field map" section to the chapter 8 doc with every line.**
- [ ] **Step 4: Run the test again plus `npx vitest run tests/recon-phase3-districts.test.js`** (the banned-phrase sweep reads all of `dialogue.js`). Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): Scout's lines for the field map`

### Task 4: Phone check, version, PR

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `docs/screenshots/broker-constellation/big-check-*.png`

- [ ] **Step 1: Run the full suite** with `npx vitest run` (or `~/.claude/bin/vast-test`). Expected: every test passes.
- [ ] **Step 2: Check it in a real browser** (Playwright MCP, viewport 375×812):
  - Open the Big Check and expand every group. Expected: `scrollWidth <= 375`.
  - Filter to nothing. Expected: `No brokers match`.
  - Tick a row, reload. Expected: it's still ticked, and its star is lit on the map.
  - Run the NAI line in a seeded save. Expected: halos show on its members and no member is lime.
  - Expected: each Scout line shows once, and the hash is never anything but the two fixed routes.
  - Screenshot each state.
- [ ] **Step 3: Bump the version** with `npm version minor --no-git-tag-version`.
- [ ] **Step 4: Commit by explicit paths, push, and open a PR** with the screenshots. Merge once the full suite is green.

## Open questions for Liz (the plan uses the default shown until she answers)

1. **NAI/DAA member lists are the organisations' own statements.** The first dataset release published tier A evidence only. Default: add them as a separate `member-list` kind that can never back a published link. It's used only for the halo, plus new `ad-network` records for members the registries don't list. Say if you'd rather they wait for the tier B review, which would mean no halo until then.
2. **Big Check scope.** The spec says "every broker not covered by a mission or sweep the player has done". Default: brokers in a mission the player hasn't done are listed too, with a link to that mission instead of a tick box. Ticks are kept for brokers no mission covers.
