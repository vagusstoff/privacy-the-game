// Fills `missions` on broker records from the step URLs in src/data/missions-reclamation.js.
// A step URL goes to: the brokers named in OVERRIDES for it; else the brokers whose optOut.url is
// that exact URL; else the one broker whose optOut/website domain (or a domain-like alias) shares
// its registrable domain. Ambiguous or unmatched URLs are printed, never guessed. NAMED_STEPS covers
// the few URL-less steps that name the broker to file with.
// Only broker missions are mapped: the spec says freezes and government steps light no stars.
// Decisions are written up in sources/MISSION-MAPPING.md.
// Usage: node research/data-brokers/build/map-missions.js [--dry-run]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registrableDomain } from './check-urls.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..', '..');
const BROKER_MISSION = /^(people_search|enterprise_data|ad_trackers|location_brokers)-/;

// Shared corporate domains (lexisnexis.com, thomsonreuters.com, transunion.com, beenverified.com, theworknumber.com)
// are carried by many registry records; these say which ones a step actually reaches.
const OVERRIDES = {
  'https://consumer.risk.lexisnexis.com/request': ['lexisnexis-risk-solutions', 'lexisnexis-risk-solutions-fl'],
  'https://optout.lexisnexis.com/': ['lexisnexis-risk-solutions', 'lexisnexis-risk-solutions-fl'],
  'https://legal.thomsonreuters.com/en/legal-notices/privacy-records': ['thomson-reuters', 'west-publishing', 'west-publising'],
  'https://www.transunion.com/consumer-privacy': ['trans-union', 'tloxp'],
  'https://www.beenverified.com/faq/opt-out/': ['beenverified', 'beenverified-llc-and-its-subsidiaries-and-affiliates'],
  // The Work Number is Equifax Workforce Solutions'. Equifax Apprise Solutions (VT) shares the domain.
  'https://employees.theworknumber.com/employment-data-report': ['equifax-workforce-solutions'],
};

// Steps with no URL that still send the player to file with one named broker.
// PeopleFinder.com is listed among Intelius, LLC's websites in its CA registry filing.
const NAMED_STEPS = {
  'people_search-fortify-removal-links': ['intelius'],
  'people_search-fortify-privacy-portals': ['intelius'],
  'people_search-reclaim-stragglers': ['mylife', 'nuwber'],
  'people_search-fortify-extended-sweep-2': ['peoplewhiz', 'quickpeopletrace', 'usatrace'],
  'people_search-fortify-extended-sweep-3': ['rocketreach'],
  'enterprise_data-fortify-property': ['corelogic'],
  'enterprise_data-reclaim-deep-layer': ['insurance-services-office'],
};

// Sweeps, tools, platforms and government sites: not brokers.
const NON_BROKER = new Set([
  'ca.gov', 'ftc.gov', 'irs.gov', 'ssa.gov', 'identitytheft.gov', 'annualcreditreport.com',
  'google.com', 'facebook.com', 'apple.com', 'thenai.org', 'aboutads.info', 'datarequests.org',
]);

const rd = (u) => { try { return registrableDomain(/^https?:/i.test(u) ? u : `https://${u}`); } catch { return null; } };
const norm = (u) => String(u).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const domainAlias = (a) => /^[\w.-]+\.[a-z]{2,}$/i.test(a.trim());

export function mapMissions(brokers, missions) {
  const byId = new Map(brokers.map((b) => [b.id, b]));
  const hits = new Map(brokers.map((b) => [b.id, new Set()]));
  const report = [];
  for (const m of missions) for (const s of m.steps ?? []) {
    if (!s.url) continue;
    const d = rd(s.url);
    let ids = [];
    let how;
    if (!BROKER_MISSION.test(m.id)) how = 'skipped: not a broker mission';
    else if (OVERRIDES[s.url]) { ids = OVERRIDES[s.url]; how = 'override'; }
    else if (NON_BROKER.has(d)) how = 'non-broker';
    else {
      ids = brokers.filter((b) => b.optOut?.url && norm(b.optOut.url) === norm(s.url)).map((b) => b.id);
      how = 'exact optOut';
      if (!ids.length) {
        ids = brokers.filter((b) => [b.optOut?.url, b.website].some((u) => u && rd(u) === d)
          || b.aliases.some((a) => domainAlias(a) && rd(a.trim()) === d)).map((b) => b.id);
        how = 'domain';
      }
      if (ids.length > 1 && how === 'domain') { how = `ambiguous: ${ids.join(', ')}`; ids = []; }
      if (!ids.length && how === 'domain') how = 'unmatched';
    }
    for (const id of ids) { if (!byId.has(id)) throw new Error(`override names unknown broker ${id}`); hits.get(id).add(m.id); }
    report.push({ mission: m.id, url: s.url, domain: d, how, ids });
  }
  for (const [mission, ids] of Object.entries(NAMED_STEPS)) {
    if (!missions.some((m) => m.id === mission)) throw new Error(`NAMED_STEPS names unknown mission ${mission}`);
    for (const id of ids) { if (!byId.has(id)) throw new Error(`NAMED_STEPS names unknown broker ${id}`); hits.get(id).add(mission); }
    report.push({ mission, url: '(step without URL)', domain: null, how: 'named step', ids });
  }
  return { hits, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const dir = join(root, 'brokers');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const brokers = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const { RECLAMATION_MISSIONS } = await import(pathToFileURL(join(repo, 'src/data/missions-reclamation.js')).href);
  const { hits, report } = mapMissions(brokers, RECLAMATION_MISSIONS);
  for (const r of report) console.log(`${r.how.padEnd(14)} ${r.mission}  ${r.url}${r.ids.length ? `  -> ${r.ids.join(', ')}` : ''}`);
  let changed = 0;
  for (const [i, b] of brokers.entries()) {
    const want = [...hits.get(b.id)].sort();
    const have = b.missions ?? [];
    if (JSON.stringify(want) === JSON.stringify(have) || (!want.length && b.missions === undefined)) continue;
    changed++;
    if (dryRun) continue;
    if (want.length) b.missions = want; else delete b.missions;
    writeFileSync(join(dir, files[i]), `${JSON.stringify(b, null, 2)}\n`);
  }
  console.log(`${changed} broker record(s) ${dryRun ? 'would change' : 'updated'}`);
}
