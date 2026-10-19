# Broker Constellation, Phase 2, Plan 1: Recording what was filed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broker mission debriefs ask "Which of these did you file?", completed broker missions can be filed again, and a pure lighting function turns the saved game into the star states the map will draw.

**Architecture:** The checklist lines live in a new data file keyed by mission id. What the player ticks is stored in new optional top-level fields of the saved game, never in `missions[id]` answers, `missionEventData` or `track()`. `brokerLighting(map, state, today)` is a pure function over `src/data/broker-map.json` and the saved game, like `lights.js`. Nothing on the map screen exists yet; Plan 2 consumes this.

**Tech Stack:** Vanilla JS ESM (no build step; `src/` is deployed as is), vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-broker-constellation-design.md`, Phase 2: "How stars light up", "Recording what was filed (Liz, 2026-10-18)", "Privacy", "Tests". Data contract: `research/data-brokers/README.md`, "The game's export".

**Plan order:** This is Plan 1 of 3. Plan 2 (`2026-10-19-broker-constellation-game-2-map.md`, the constellation screen) needs this merged. Plan 3 (`2026-10-19-broker-constellation-game-3-big-check.md`: Big Check, Scout lines, NAI/DAA halo data) needs Plans 1 and 2.

## Global Constraints

- No new npm dependencies, runtime or dev.
- `STATE_VERSION` stays `1`. `loadState` replaces any save whose version differs, so a bump would wipe every player's city.
- Old saves never lose progress. Migrations only clean values. Nothing already earned (district %, city lights, collective counts) changes.
- Nothing per-broker goes through `track()`, `missionEventData`, `restoreEvents` or the URL. That covers broker ids, ticked lines, residency and Big Check ticks.
- How `debriefRecord` treats "some" stays the same for district progress. The checklist feeds only the map.
- Lighting table (spec, verbatim):
  - a broker mission's "which did you file?" checklist lights exactly the brokers ticked there;
  - a legacy completed mission answered "all submitted" lights every broker that mission's steps cover (`missions` field on broker records);
  - a legacy "some submitted" answer lights nothing until the player fills in the new checklist;
  - DROP lights CA-registered brokers only if the player says they're a California resident;
  - NAI/DAA light nothing and give their members a "this browser only" halo, never lime;
  - a Big Check tick lights that one broker.
- Re-check: people-search brokers turn amber 90 days after they were lit. Stars lit by DROP never go amber.
- Credit freezes light nothing. They show as a "frozen" ring on the bureau stars.
- Residency answers: Yes / No / Rather not say. "No" and "Rather not say" mean DROP lights nothing.
- Every PR bumps the version (`package.json` + `package-lock.json`).
- Copy follows the v5.0 recon rules: no claim we can't verify, and no numbers we can't source.

## Review Focus

1. **An old save answered "Submitted all of them", then filed again with only some lines ticked.** Expected: the lines not re-ticked stay lit at the mission's `completedAt` day. Re-filing never unlights anything. Pinned by Task 3's `legacy all, then a partial re-file, keeps the rest lit`.
2. **A save with malformed broker fields** (`brokerFiled: "x"`, a line dated `"soon"`, `caResident: "maybe"`, `bigCheck: [1]`). Expected: it loads, every mission and district % is kept, and only the bad values are dropped. Pinned by Task 2's `cleanBrokerState drops bad values and keeps missions`.
3. **The player ticks lines, then answers "I'll come back to this".** Expected: nothing is recorded and nothing lights. Pinned by Task 4's `a skipped filing records no lines`.
4. **The device clock is set back, so a line's date is after today.** Expected: the star is lit, not amber, and nothing throws. Pinned by Task 3's `a date after today is lit, not amber`.
5. **A line id in the save that no longer exists in the checklist** (a later release renames a line). Expected: it is ignored and never lights a broker by accident. Pinned by Task 3's `unknown line ids are ignored`.

---

## File Structure

```
src/data/broker-checklists.js     BROKER_CHECKLISTS (lines per mission), LEGACY_ALL_ANSWERS, FREEZE_RINGS
src/utils/broker-state.js         saved-game fields: cleanBrokerState, recordChecklist, setResidency, setBigCheck
src/utils/broker-lighting.js      brokerLighting, lineDates, fieldCoverage, fieldHeader, isBuyer, RECHECK_DAYS
src/components/broker-checklist.js  renderBrokerChecklist(mission, state, mode)
src/state.js                      loadState calls cleanBrokerState
src/screens/debrief.js            renders the checklist (open form) and the "filed again" panel (completed)
src/screens/district.js           FILE AGAIN link on completed broker missions
src/app.js                        reads ticks on SUBMIT REPORT and on SAVE; ticks all on "Submitted all"
tests/fixtures/broker-map-mini.json  small map for lighting tests
tests/broker-game/*.test.js
```

Saved-game fields (all optional; an old save has none):

```
brokerFiled: { [missionId]: { lines: { [lineId]: 'YYYY-MM-DD' }, since?: 'YYYY-MM-DD' } }
  // since: the day this mission was first filed with the checklist. Absent = the mission was filed
  // before the checklist existed (a legacy filing), so its legacy answer still counts.
caResident: 'yes' | 'no' | 'unsaid'      // absent = not asked yet
bigCheck: { [brokerId]: 'YYYY-MM-DD' }   // Plan 3 writes it; lighting reads it here
```

---

### Task 1: Checklist lines per mission

**Files:**
- Create: `src/data/broker-checklists.js`
- Test: `tests/broker-game/checklists.test.js`

**Interfaces:**
- Produces:
  - `type Line = { id: string, label: string, brokers?: string[], sweep?: 'drop' | 'nai' | 'daa', hint?: string }`
  - `BROKER_CHECKLISTS: Record<missionId, Line[]>`, frozen.
  - `checklistFor(missionId: string): Line[] | null`
  - `LEGACY_ALL_ANSWERS = { optout_result: ['all-submitted'], defense_done: ['done', 'already-done'] }`. A legacy filing counts as "all" when its record holds one of these.
  - `FREEZE_RINGS: Array<{ mission: string, question: string, values: string[], brokers: string[] }>`:
    - `credit_freeze-fortify-equifax`, `freeze_status`, `['already-frozen', 'now-frozen']`, `['equifax-information-services']`
    - `credit_freeze-fortify-experian`, same answers, `['experian-information-solutions']`
    - `credit_freeze-fortify-transunion`, same answers, `['trans-union']`
    - `credit_freeze-fortify-extras`, `freeze_extras`, `['both-frozen']`, `['innovis', 'chex-systems']`

The lines, one per step that reaches a broker record or a sweep (step-to-broker matching is `research/data-brokers/build/map-missions.js`; `--dry-run` prints it). Steps that reach no record (Privateeye, FindPeopleSearch, Google Results About You, the complaint forms, Oracle, X-Mode, Gravy) get no line.

| Mission | Line id: label → brokers |
|---|---|
| `people_search-fortify-web-forms` | `spokeo`: Spokeo → spokeo · `whitepages`: Whitepages → whitepages · `beenverified`: BeenVerified → beenverified, beenverified-llc-and-its-subsidiaries-and-affiliates |
| `people_search-fortify-removal-links` | `intelius`: Intelius → intelius · `truepeoplesearch`: TruePeopleSearch → free-data-services · `fastpeoplesearch`: FastPeopleSearch → mississippi-tornado-alley |
| `people_search-fortify-privacy-portals` | `radaris`: Radaris → radaris · `usphonebook`: USPhonebook → mississippi-tornado-alley · `thatsthem`: ThatsThem → spokeo · `peoplefinder`: PeopleFinder → intelius |
| `people_search-reclaim-stragglers` | `mylife`: MyLife → mylife · `nuwber`: Nuwber → nuwber · `drop`: California DROP (sweep `drop`) |
| `people_search-fortify-extended-sweep-1` | `smartbackgroundchecks`: SmartBackgroundChecks → mississippi-tornado-alley · `searchpeoplefree`: SearchPeopleFree → mississippi-tornado-alley |
| `people_search-fortify-extended-sweep-2` | `peoplewhiz`: PeopleWhiz → peoplewhiz · `spydialer`: SpyDialer → spy-labs-adco · `anywho`: Anywho (Spokeo's form) → spokeo · `quickpeopletrace`: QuickPeopleTrace → quickpeopletrace · `usatrace`: Usatrace → usatrace |
| `people_search-fortify-extended-sweep-3` | `rocketreach`: RocketReach → rocketreach |
| `enterprise_data-fortify-lexisnexis` | `lexisnexis`: LexisNexis consumer opt-out → lexisnexis-risk-solutions, lexisnexis-risk-solutions-fl |
| `enterprise_data-fortify-thomson` | `thomson-clear`: Thomson Reuters CLEAR request → thomson-reuters, west-publishing, west-publising |
| `enterprise_data-fortify-property` | `corelogic`: CoreLogic (Cotality) → corelogic · `transunion-tlo`: TransUnion consumer privacy request (TLO) → trans-union, tloxp |
| `enterprise_data-reclaim-deep-layer` | `verisk-iso`: Verisk / ISO ClaimSearch → insurance-services-office · `work-number`: The Work Number → equifax-workforce-solutions · `data-axle`: Data Axle → data-axle · `sift`: Sift → sift |
| `ad_trackers-fortify-bulk` | `nai`: NAI opt-out tool (sweep `nai`) · `daa`: DAA WebChoices (sweep `daa`) |
| `ad_trackers-reclaim-individual` | `liveramp`: LiveRamp → liveramp · `acxiom`: Acxiom → acxiom · `lotame`: Lotame → lotame-solutions · `epsilon`: Epsilon → epsilon-data-management |
| `location_brokers-fortify-optout` | `safegraph`: SafeGraph → safegraph · `placer-ai`: Placer.ai → placer-ai |
| `location_brokers-reclaim-legal` | `drop`: California DROP (sweep `drop`) |

Hints (exact copy):
- `drop`: `California residents only. It lights the map only if you tell the map you live in California.`
- `nai`, `daa`: `Sets an opt-out cookie in this browser on this device. It deletes nothing.`

- [ ] **Step 1: Write the failing tests**

```js
const map = JSON.parse(readFileSync('src/data/broker-map.json', 'utf8'));
const ids = new Set(map.brokers.map((b) => b.id));
const RECON = /-recon-/;

it('every line broker exists in broker-map.json', () => {
  for (const lines of Object.values(BROKER_CHECKLISTS)) for (const l of lines) for (const b of l.brokers ?? []) expect(ids.has(b), b).toBe(true);
});
it('lines match the dataset mapping exactly, mission by mission', () => {
  // union of a mission's line brokers === brokers whose `missions` lists it (recon missions excluded)
  const want = {};
  for (const b of map.brokers) for (const m of b.missions) if (!RECON.test(m)) (want[m] ??= new Set()).add(b.id);
  for (const [m, set] of Object.entries(want)) expect(new Set(checklistFor(m).flatMap((l) => l.brokers ?? []))).toEqual(set);
});
it('a line is a broker line or a sweep, never both', ...);
it('line ids are unique within a mission', ...);
it('every checklist mission exists in MISSIONS and is not recon', ...);
it('DROP is its own line in both DROP missions', () => {
  expect(checklistFor('people_search-reclaim-stragglers').find((l) => l.id === 'drop').sweep).toBe('drop');
  expect(checklistFor('location_brokers-reclaim-legal').map((l) => l.id)).toEqual(['drop']);
});
it('freeze missions have no checklist', () => expect(checklistFor('credit_freeze-fortify-equifax')).toBe(null));
it('every FREEZE_RINGS broker exists', ...);
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/checklists.test.js` and confirm it fails** (module missing).
- [ ] **Step 3: Write `src/data/broker-checklists.js`** with the table above.
- [ ] **Step 4: Run the test again.** Expected: PASS. If `lines match the dataset mapping` fails, the table or the dataset is wrong. Fix the table to follow `map-missions.js`, never the dataset by hand.
- [ ] **Step 5: Commit**: `feat(broker-map): checklist lines for each broker mission`

### Task 2: Saved-game fields and their clean-up

**Files:**
- Create: `src/utils/broker-state.js`
- Modify: `src/state.js` (`loadState`: `return cleanBrokerState(migrateBrokenAnswers(parsed));`)
- Test: `tests/broker-game/broker-state.test.js`

**Interfaces:**
- Consumes: `checklistFor` (Task 1).
- Produces:
  - `RESIDENCY = ['yes', 'no', 'unsaid']`
  - `cleanBrokerState(state) → state`. It keeps only well-formed values: `brokerFiled` entries that are objects with a `lines` object, line values that are real `YYYY-MM-DD` days, `since` only when it's a real day, `caResident` only from `RESIDENCY`, and `bigCheck` only as an object of real days. It returns the same object when nothing changed. It never touches `missions`.
  - `recordChecklist(state, missionId, lineIds: string[], day: string, { first = false } = {}) → state`. It sets `lines[id] = day` for each id that is a line of that mission (other ids are dropped), and sets `since = day` when `first` and `since` is absent. It returns `state` unchanged when the mission has no checklist or `lineIds` is empty and `first` is false.
  - `setResidency(state, value) → state`. A value outside `RESIDENCY` deletes the field (back to "not asked").
  - `setBigCheck(state, brokerId, ticked: boolean, day) → state`. Ticked sets the day, unticked deletes the key.

- [ ] **Step 1: Write the failing tests**

```js
it('STATE_VERSION stays 1', () => expect(STATE_VERSION).toBe(1));
it('cleanBrokerState drops bad values and keeps missions', () => {
  const s = { missions: { a: { status: 'completed' } }, brokerFiled: 'x', caResident: 'maybe', bigCheck: [1] };
  expect(cleanBrokerState(s)).toEqual({ missions: { a: { status: 'completed' } } });
  const t = { missions: {}, brokerFiled: { m: { lines: { spokeo: '2026-07-01', whitepages: 'soon' }, since: 'x' }, n: null } };
  expect(cleanBrokerState(t).brokerFiled).toEqual({ m: { lines: { spokeo: '2026-07-01' } } });
});
it('an old save without the fields is returned as is', () => { const s = { missions: {} }; expect(cleanBrokerState(s)).toBe(s); });
it('loadState of a corrupted broker field keeps the city', ...); // via mock storage, as in tests/state.test.js
it('recordChecklist first filing sets lines and since', () => {
  const s = recordChecklist({}, 'people_search-fortify-web-forms', ['spokeo', 'bogus'], '2026-10-19', { first: true });
  expect(s.brokerFiled['people_search-fortify-web-forms']).toEqual({ lines: { spokeo: '2026-10-19' }, since: '2026-10-19' });
});
it('re-filing updates dates and never sets since', ...);
it('a first filing with no ticks still records since', ...); // so legacy "all" no longer applies to it
it('recordChecklist on a mission with no checklist is a no-op', ...);
it('setResidency accepts yes/no/unsaid and clears anything else', ...);
it('setBigCheck ticks and unticks', ...);
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/broker-state.test.js` and confirm it fails.**
- [ ] **Step 3: Implement `broker-state.js` and wire `cleanBrokerState` into `loadState`.** Use a `YYYY-MM-DD` round-trip check like `dayValue` in `state.js`.
- [ ] **Step 4: Run the new test plus `npx vitest run tests/state.test.js tests/breaker-phase1`.** Expected: all PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): saved-game fields for filed lines, residency and ticks`

### Task 3: The lighting function and coverage

**Files:**
- Create: `src/utils/broker-lighting.js`, `tests/fixtures/broker-map-mini.json`
- Test: `tests/broker-game/lighting.test.js`

**Interfaces:**
- Consumes: `BROKER_CHECKLISTS`, `LEGACY_ALL_ANSWERS`, `FREEZE_RINGS` (Task 1); `localDay` from `src/state.js`.
- Produces:
  - `RECHECK_DAYS = 90`
  - `isBuyer(broker) → boolean`: `kind` includes `buyer`.
  - `lineDates(state, missionId, checklists = BROKER_CHECKLISTS) → Record<lineId, day>`. The mission's recorded lines, plus, for a legacy "all" filing (completed, a `LEGACY_ALL_ANSWERS` answer, no `since`), every line not recorded dated `localDay(new Date(record.completedAt))`.
  - `isChecklistPending(state, missionId, checklists = BROKER_CHECKLISTS) → boolean`: the mission is completed, has a checklist, and `lineDates` is empty.
  - `brokerLighting(map, state, today: string, checklists = BROKER_CHECKLISTS) → Lighting`:
    ```
    Lighting = {
      stars: { [id]: { state: 'lit' | 'amber' | 'no-opt-out' | 'dim', litOn: string | null, via: Array<'checklist' | 'legacy' | 'drop' | 'big-check'> } },
      frozen: string[],     // sorted ids with a "frozen" ring
      halo: string[],       // sorted ids with the "this browser only" halo (members of a filed NAI/DAA sweep, from map.sweeps?.[s]?.members ?? [])
      pending: string[],    // sorted mission ids where isChecklistPending (Scout's "Tell Scout which ones you filed")
      drop: 'off' | 'ask' | 'not-resident' | 'lit',   // off: DROP not filed; ask: filed, residency unanswered
    }
    ```
    The rules, in order:
    - A broker line dated in `lineDates` lights its brokers (`checklist`, or `legacy` when the date came from `completedAt`).
    - A filed `drop` line with `caResident === 'yes'` lights every broker with a truthy `registries.CA` (`drop`).
    - A Big Check day lights that broker (`big-check`).
    - `litOn` is the latest of the dates.
    - Buyers are never lit.
    - A lit star is `amber` when its `kind` includes `people-search`, `drop` is not in `via`, and `today - litOn >= 90` days.
    - An unlit broker with `optOut?.method === 'none'` is `no-opt-out`.
    - Unknown missions, unknown line ids and bad dates are ignored.
  - `fieldCoverage(map, lighting) → { percent: number, hubsLit: number, hubsTotal: number }`:
    - `reachable(b) = !isBuyer(b) && (b.optOut?.method !== 'none' || lit(b))`
    - `percent = Math.floor(100 * Σ reach of lit-or-amber reachable stars / Σ reach of reachable stars)` (0 when the denominator is 0)
    - `hubsLit` counts hubs that are lit or amber; `hubsTotal` counts `hub: true`
  - `fieldHeader({ percent, hubsLit, hubsTotal }) → string`: `` `FIELD COVERED: ${percent}% · HUBS LIT ${hubsLit}/${hubsTotal}` ``

`broker-map-mini.json` is `formatVersion: 1`, `links: []`. Brokers, each `{ reach: 1, hub: false, optOut: { method: 'web-form', url: 'https://example.test/x', status: 'verified' } }` unless noted:

| id | kind | CA | missions | notes |
|---|---|---|---|---|
| spokeo | people-search | yes | web-forms, privacy-portals | |
| whitepages | people-search | no | web-forms | |
| beenverified | people-search | no | web-forms | |
| acxiom | marketing | yes | ad_trackers-reclaim-individual | |
| lexisnexis-risk-solutions | risk-identity | no | enterprise_data-fortify-lexisnexis | |
| equifax-information-services | financial | yes | — | |
| hub-a | risk-identity | yes | — | reach 6, hub true |
| tail-1 | — | yes | — | |
| tail-2 | — | no | — | optOut null |
| nope | marketing | no | — | optOut method none |
| us-ice | buyer | no | — | optOut null |
| criteo | ad-network | no | — | |

Plus `sweeps: { nai: { members: ['criteo'] }, daa: { members: ['criteo'] } }`. The test passes a `checklists` built from the real one, restricted to these ids. Reachable reach in this fixture totals 15.

- [ ] **Step 1: Write the failing tests** (`today = '2026-10-19'` unless noted)

```js
it('nothing filed: every star dim, nope is no-opt-out, 0%', () => {
  const l = brokerLighting(mini, {}, '2026-10-19', cl);
  expect(l.stars.spokeo.state).toBe('dim'); expect(l.stars.nope.state).toBe('no-opt-out');
  expect(fieldCoverage(mini, l)).toEqual({ percent: 0, hubsLit: 0, hubsTotal: 1 });
});
it('checklist lights exactly the ticked brokers', ...);           // spokeo line only → spokeo lit, whitepages dim
it('legacy all submitted lights every broker the mission covers', ...); // web-forms {completed, all-submitted, completedAt '2026-03-01T12:00:00.000Z'} → spokeo, whitepages, beenverified lit, litOn '2026-03-01', via ['legacy']
it('legacy defense done counts as all', ...);                      // enterprise_data-fortify-lexisnexis defense_done 'done'
it('legacy some submitted lights nothing and is pending', ...);    // pending: ['people_search-fortify-web-forms']
it('filling in the checklist clears pending', ...);
it('a new filing ignores its all-submitted answer', ...);          // since set, lines {spokeo} → whitepages dim
it('legacy all, then a partial re-file, keeps the rest lit', ...); // re-file spokeo '2026-10-19'; whitepages still lit at '2026-03-01'
it('DROP with residency yes lights CA-registered brokers only', () => {
  // drop ticked in stragglers, caResident 'yes' → spokeo, acxiom, equifax-information-services, hub-a, tail-1 lit via drop; whitepages dim; us-ice dim
});
it.each([['no'], ['unsaid']])('DROP with residency %s lights nothing', ...);  // drop: 'not-resident'
it('DROP with residency unanswered lights nothing and asks', ...);           // drop: 'ask'
it('people-search turns amber at 90 days, not 89', () => {
  // spokeo line dated '2026-07-01': today '2026-09-28' → lit, today '2026-09-29' → amber
});
it('non-people-search never goes amber', ...);                     // acxiom dated '2026-01-01' → lit
it('a DROP-lit star never goes amber', ...);                       // spokeo dated '2026-01-01' and DROP-lit → lit
it('a date after today is lit, not amber', ...);
it('a freeze lights nothing and rings the bureau', ...);           // credit_freeze-fortify-equifax freeze_status 'now-frozen' → frozen ['equifax-information-services'], its state 'dim'
it('NAI gives a halo, never a light', ...);                        // halo ['criteo'], criteo 'dim'
it('a Big Check tick lights that broker', ...);                    // bigCheck {tail-2: '2026-10-01'} → tail-2 lit via ['big-check']
it('buyers are never lit', ...);
it('unknown line ids are ignored', ...);                           // lines {gone: '2026-10-01'} → nothing lit
it('coverage is reach-weighted, floored, deterministic', () => {
  // spokeo alone → 6 (1/15); hub-a alone → 40 (6/15); every reachable star but tail-2 → 93 (14/15); all reachable → 100
});
it('a lit no-opt-out star counts toward coverage', ...);          // nope via Big Check → it joins numerator and denominator
it('fieldHeader', () => expect(fieldHeader({ percent: 31, hubsLit: 3, hubsTotal: 12 })).toBe('FIELD COVERED: 31% · HUBS LIT 3/12'));
it('the real map has 12 hubs', () => expect(fieldCoverage(realMap, brokerLighting(realMap, {}, '2026-10-19')).hubsTotal).toBe(12));
it('an old save with no broker fields never throws', ...);         // {missions: {...}} and {} and null-ish brokerFiled entries
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/lighting.test.js` and confirm it fails.**
- [ ] **Step 3: Implement `broker-lighting.js`.** Day differences go through UTC-midnight values, as `dayValue` does in `state.js`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): pure lighting function and reach-weighted coverage`

### Task 4: "Which of these did you file?" in the debrief

**Files:**
- Create: `src/components/broker-checklist.js`
- Modify: `src/screens/debrief.js` (`debriefForm` appends the checklist), `src/utils/broker-state.js` (`applyChecklistFiling`), `src/app.js` (`submitDebrief`, `refreshDebriefForm`)
- Test: `tests/broker-game/debrief-checklist.test.js`

**Interfaces:**
- Consumes: `checklistFor`, `LEGACY_ALL_ANSWERS` (Task 1); `recordChecklist` (Task 2); `lineDates`, `isChecklistPending` (Task 3); `localDay`.
- Produces:
  - `renderBrokerChecklist(mission, state, mode: 'file' | 'refile') → string` (`''` when the mission has no checklist). File mode renders `<div data-broker-checklist="<missionId>">` with the label `WHICH OF THESE DID YOU FILE?`, the sub-line `Only this browser keeps this. It lights your field map and is never sent anywhere.`, and one `<input type="checkbox" name="filed" value="<lineId>">` per line, unticked, plus the line's `hint`. Refile mode is Task 5's.
  - `checklistTicksFor(questionId: string, value: string) → 'all' | 'none' | null`, exported from `broker-checklist.js`. It returns `'all'` for a `LEGACY_ALL_ANSWERS` value, `'none'` for `skip`, and `null` otherwise.
  - `applyChecklistFiling(state, missionId, status, lineIds, day) → state` in `broker-state.js`. It is `recordChecklist(..., { first: true })` when `status === 'completed'`, else `state`.
- `app.js`:
  - `submitDebrief` reads `[data-broker-checklist] input[name="filed"]:checked` and, after `fileDebrief`, applies `applyChecklistFiling(filed.state, missionId, filed.event?.status, ticks, localDay())` before `setState`.
  - `refreshDebriefForm` applies `checklistTicksFor` when the mission's first question changes, ticking or unticking every `filed` box once (the player can still change them).
  - Neither touches `track()`.

- [ ] **Step 1: Write the failing tests**

```js
it('an open broker debrief lists one tick box per line', () => {
  const html = renderDebrief(createInitialState(), 'people_search-fortify-web-forms');
  expect([...html.matchAll(/name="filed" value="([^"]+)"/g)].map((m) => m[1])).toEqual(['spokeo', 'whitepages', 'beenverified']);
});
it('DROP is its own line with its hint', ...);
it('a mission with no checklist renders none', ...);   // credit_freeze-fortify-equifax, ad_trackers-fortify-platforms
it('checklistTicksFor', () => {
  expect(checklistTicksFor('optout_result', 'all-submitted')).toBe('all');
  expect(checklistTicksFor('optout_result', 'some-submitted')).toBe(null);
  expect(checklistTicksFor('optout_result', 'skip')).toBe('none');
  expect(checklistTicksFor('defense_done', 'already-done')).toBe('all');
});
it('a completed filing records the ticked lines with since', ...);
it('a skipped filing records no lines', ...);  // applyChecklistFiling(state, id, 'skipped', ['spokeo'], day) === state
it('the checklist never reaches the mission record or its event', () => {
  // fileDebrief + applyChecklistFiling; missions[id] has no 'filed'/'lines' key; missionEventData(...) has no line ids
});
it('district progress is the same with and without brokerFiled', ...); // calcDistrictProgress(state, 'reclamation')
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/debrief-checklist.test.js` and confirm it fails.**
- [ ] **Step 3: Implement the component, `checklistTicksFor` and `applyChecklistFiling`, and wire `debrief.js` and `app.js`.** The checkbox rows reuse the debrief's `debrief-opt` row style.
- [ ] **Step 4: Run the test plus `npx vitest run tests/recon-phase2-review.test.js tests/passwords-2fa-ui.test.js`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): debrief asks which brokers you filed`

### Task 5: File again (debrief panel and district link)

**Files:**
- Modify: `src/components/broker-checklist.js` (refile mode), `src/screens/debrief.js` (completed view), `src/screens/district.js` (`renderMissionRow`), `src/app.js` (action `refile-brokers`)
- Test: `tests/broker-game/refile.test.js`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - Refile mode renders `<div data-broker-checklist="<missionId>" data-mode="refile">`. The label is `FILED AGAIN?`, or `TELL SCOUT WHICH ONES YOU FILED` when `isChecklistPending(state, id)` (it needs no map). Each line shows `Last filed YYYY-MM-DD` or `Not recorded yet`, then an unticked box, then `<button data-action="refile-brokers" data-mission="<id>">SAVE</button>`.
  - `renderDebrief` for a completed checklist mission appends the refile panel after the locked answers.
  - `renderMissionRow` for a completed mission with a checklist adds `<a href="#/mission/<id>/briefing">FILE AGAIN</a>` beside SECURED. The briefing already shows a completed mission's steps and leads to the debrief.
  - `app.js` `refile-brokers`: `setState(recordChecklist(state, id, ticks, localDay()))`, then a REFRESH render. The mission record, `completedAt`, streak and events are untouched.

- [ ] **Step 1: Write the failing tests**

```js
it('a completed broker debrief shows the refile panel with dates', () => {
  // legacy all, completedAt '2026-03-01T12:00:00.000Z' → 'Last filed 2026-03-01' on all three lines, label 'FILED AGAIN?'
});
it('a legacy some-submitted debrief asks Scout\'s question', ...);   // label 'TELL SCOUT WHICH ONES YOU FILED', 'Not recorded yet'
it('re-filing keeps the mission completed and its completedAt', ...);
it('the district offers FILE AGAIN only on completed checklist missions', () => {
  // completed web-forms row has href="#/mission/people_search-fortify-web-forms/briefing">FILE AGAIN; an open one and a completed freeze don't
});
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game/refile.test.js` and confirm it fails.**
- [ ] **Step 3: Implement refile mode, the debrief panel, the district link and the action.**
- [ ] **Step 4: Run the test again plus `npx vitest run tests/district-phase-gating.test.js`.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(broker-map): file a broker mission again`

### Task 6: Privacy guard, version, PR

**Files:**
- Test: `tests/broker-game/privacy.test.js`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Write the tests**

```js
it('restoreEvents is identical with and without the broker fields', ...);
it('the new modules never import analytics', () => {
  for (const f of ['src/utils/broker-state.js', 'src/utils/broker-lighting.js', 'src/components/broker-checklist.js', 'src/data/broker-checklists.js'])
    expect(readFileSync(f, 'utf8')).not.toMatch(/analytics|track\(/);
});
```

- [ ] **Step 2: Run `npx vitest run tests/broker-game`.** Expected: PASS.
- [ ] **Step 3: Bump the version** with `npm version minor --no-git-tag-version`.
- [ ] **Step 4: Run the full suite** with `npx vitest run` (or `~/.claude/bin/vast-test`). Expected: every test passes.
- [ ] **Step 5: Check it in a browser at 375px** (Playwright). File `people_search-fortify-web-forms` with two of three ticked, reopen the debrief, save a re-file, and confirm there's no horizontal scroll. Save the screenshots under `docs/screenshots/broker-constellation/`.
- [ ] **Step 6: Commit, push, and open a PR.** Commit by explicit paths. Merge once the full suite is green.

## Open questions for Liz (the plan uses the default shown until she answers)

1. **One site of a multi-site company.** Ticking USPhonebook lights the `mississippi-tornado-alley` star, the company behind FastPeopleSearch, SmartBackgroundChecks and SearchPeopleFree, and ThatsThem lights `spokeo`. The dataset ties those sites to the company record. Default: any line lights the company's star. The alternative is a star that lights only once every one of its lines is ticked. Either is a one-function change in `brokerLighting`.
2. **Do amber (re-check due) stars still count toward FIELD COVERED?** Default: yes. Amber is a nudge, not a loss.
