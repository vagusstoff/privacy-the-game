// Registry import: turns a state data-broker registry snapshot (CSV) into broker records.
// CLI: node import-registry.js <STATE> <csvPath> <snapshotDate> [archivedUrl]
import { normalizeName, slugify } from './ids.js';
import { parseCsv } from './csv.js';
import { KINDS, REGISTRY_KEYS, validateDataset } from './schema.js';

// Header names copied verbatim from each registry's real download (see sources/registries/SOURCES.md).
// `email` is mapped only where the registry labels it an opt-out address (OR). CA and TX publish a
// general contact email, which is not an opt-out route, so it is left out.
// `flags` are yes/no columns that map unambiguously onto one kind.
// `onlyWhere` keeps only rows whose column has one of the listed values (VT lists lapsed registrations too).
export const COLUMN_MAPS = Object.freeze({
  CA: {
    name: 'Data broker name:',
    dba: 'Doing Business As (DBA), if applicable:',
    website: 'Data broker primary website:',
    optOutUrl: "Data broker's primary website that contains details on how consumers can exercise their CA Consumer Privacy rights:",
    flags: {
      "Data broker collects consumers' precise geolocation": 'location',
      'Data broker collects consumers’ reproductive health care data:': 'health',
    },
  },
  TX: {
    name: 'Full Legal Name',
    website: 'Website',
    optOutUrl: 'Consumer Rights Link',
    // Free text written by each broker; it has no fixed labels to map, so every value is "unknown".
    category: 'Categories of Data Processed and Transferred',
  },
  OR: {
    name: 'FACILITY NAME',
    dba: 'DOING BUSINESS AS',
    optOutUrl: 'OPT OUT WEBSITE',
    email: 'OPT OUT EMAIL',
  },
  VT: {
    name: 'Name',
    website: 'PrimaryInterneturl',
    // Free text describing how to opt out; used only when the whole answer is a URL or an email address.
    // "EmailAddress" is the broker's general contact email, not an opt-out route, so it is left out.
    optOutUrl: 'OptOutMethod',
    // The bulk file also lists registrations that lapsed ("Unregistered", mostly expired 2/1/2026).
    onlyWhere: { DataBrokerStatus: ['Registered'] },
  },
});

// Exact (lower-cased, trimmed) registry category labels → kind. Only unambiguous labels belong here.
// No obtained registry has fixed category labels (VT has no category column at all), so every map is
// empty and categories give kind: [].
export const CATEGORY_MAP = Object.freeze({ CA: {}, TX: {}, OR: {}, VT: {} });

// Registry pages, for the sources.json entry.
export const REGISTRY_META = Object.freeze({
  CA: { url: 'https://cppa.ca.gov/data_broker_registry/registry.csv', title: 'California Privacy Protection Agency, California Data Broker Registry (2026 registrations)' },
  TX: { url: 'https://texas-sos.appianportalsgov.com/data-broker-registry', title: 'Texas Secretary of State, Registry of Registered Data Brokers (Export to Excel)' },
  OR: { url: 'https://www4.cbs.state.or.us/ex/shared/downtemp/dfcs_db_optout.csv', title: 'Oregon DCBS Division of Financial Regulation, Data Broker Opt Out Methods report' },
  // The bulk file sits behind a login and has no public URL; this is the registry's public search page.
  VT: { url: 'https://bizfilings.vermont.gov/databrokersearch/Search', title: 'Vermont Secretary of State, Data Broker registry (Bulk Database Download, "Data Broker" file)' },
});

const BLANK = /^(|n\/?a\.?|none\.?|null|not applicable|-+)$/i;
// Yes/no answers typed into a DBA box are form noise, not trade names.
const NOT_A_DBA = /^(yes|no|same|same as above)\.?$/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?$/i;
const EMAIL_RE = /^(?:mailto:)?([^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,})$/i;

const clean = (v) => {
  const s = String(v ?? '').trim();
  return BLANK.test(s) ? '' : s;
};

// A field "holds a URL" only when the whole value is one: free text is never mined for links.
export function asUrl(v) {
  const s = clean(v).replace(/[.,;]+$/, '');
  if (URL_RE.test(s)) return s;
  if (BARE_DOMAIN.test(s) && !s.includes('@')) return `https://${s}`;
  return null;
}

export function asEmail(v) {
  const m = clean(v).match(EMAIL_RE);
  return m ? m[1] : null;
}

// CA joins several answers with "; ". A field made only of URLs gives its first URL.
export function firstUrl(v) {
  const whole = asUrl(v);
  if (whole) return whole;
  const parts = clean(v).split(/\s*[;,]\s*|\s+/).filter(Boolean);
  const urls = parts.map(asUrl);
  return parts.length > 1 && urls.every(Boolean) ? urls[0] : null;
}

function optOutFrom(row, col) {
  const field = row(col.optOutUrl);
  const url = firstUrl(field);
  if (url) return { method: 'web-form', url, status: 'unchecked' };
  const email = asEmail(field) ?? (col.email ? asEmail(row(col.email)) : null);
  if (email) return { method: 'email', email };
  return null;
}

function newBroker(id, name) {
  return {
    id, name, aliases: [], parent: null, kind: [],
    registries: Object.fromEntries(REGISTRY_KEYS.map((k) => [k, null])),
    sells: [], optOut: null, size: { known: false, signals: [] }, sources: [],
  };
}

const addUnique = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
const sortKinds = (ks) => KINDS.filter((k) => ks.includes(k));

// Matching key: normalizeName with spaces removed, so "BEEN VERIFIED" = "BeenVerified".
export const legalKey = (name) => normalizeName(name).replace(/ /g, '');

// "Acme LLC d/b/a Acme Data" → ["Acme LLC", "Acme Data"]. A name with no d/b/a comes back alone.
const DBA_SPLIT = /\s*[(,]?\s*\b(?:d\s*\/\s*b\s*\/\s*a|d\.b\.a\.?|dba|doing business as)\b[:.]?\s*/i;
export function splitDba(name) {
  const m = String(name).match(DBA_SPLIT);
  if (!m) return [name];
  const legal = name.slice(0, m.index).replace(/[\s,]+$/, '').trim();
  const dba = name.slice(m.index + m[0].length).replace(/^\s+|[\s)]+$/g, '').trim();
  if (!legal || !dba) return [name];
  return [legal, dba];
}

// Pairs of records that share a spelling (a DBA, brand or alias) but have different legal names.
// They are never merged automatically; the research pass decides. Sorted, so output is stable.
export function mergeCandidates(brokers) {
  const byKey = new Map(); // legalKey → Map(id → spelling)
  const list = [...brokers].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const b of list) {
    for (const n of [b.name, ...b.aliases]) {
      const k = legalKey(n);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, new Map());
      const ids = byKey.get(k);
      if (!ids.has(b.id)) ids.set(b.id, n);
    }
  }
  const regs = (b) => REGISTRY_KEYS.filter((k) => b.registries?.[k]).join(',');
  const byId = new Map(list.map((b) => [b.id, b]));
  const out = [];
  for (const ids of byKey.values()) {
    const entries = [...ids];
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const [a, sa] = entries[i]; const [b, sb] = entries[j];
      out.push({ a, b, shared: sa.length <= sb.length ? sa : sb, registriesA: regs(byId.get(a)), registriesB: regs(byId.get(b)) });
    }
  }
  const seen = new Set();
  return out
    .sort((x, y) => (x.a + '\0' + x.b + '\0' + x.shared).localeCompare(y.a + '\0' + y.b + '\0' + y.shared))
    .filter((c) => { const k = `${c.a}|${c.b}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Merge one registry's rows into a copy of `existing`. Pure: the input map and records are not mutated.
export function importRows(state, rows, existing, sourceId) {
  const col = COLUMN_MAPS[state];
  if (!col) throw new Error(`no column map for registry "${state}"`);
  const year = String(sourceId).match(/(\d{4})-\d{2}-\d{2}$/)?.[1];
  if (!year) throw new Error(`sourceId "${sourceId}" must end in a YYYY-MM-DD snapshot date`);

  const out = new Map([...existing].map(([id, b]) => [id, structuredClone(b)]));
  // Records match only on their legal name (record.name). DBAs and aliases never join two records;
  // shared ones are reported by mergeCandidates instead.
  const index = new Map(); // legalKey(name) → id
  for (const b of [...out.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) { const k = legalKey(b.name); if (k && !index.has(k)) index.set(k, b.id); }

  // Some exports carry metadata rows above the header (TX); find the real header row.
  const h = rows.findIndex((r) => r.map((c) => c.trim()).includes(col.name));
  if (h === -1) throw new Error(`${state}: header "${col.name}" not found`);
  const header = rows[h].map((c) => c.trim());
  const at = (r) => (name) => { const i = name ? header.indexOf(name) : -1; return i === -1 ? '' : (r[i] ?? ''); };

  for (const r of rows.slice(h + 1)) {
    const row = at(r);
    if (col.onlyWhere && !Object.entries(col.onlyWhere).every(([hdr, ok]) => ok.includes(clean(row(hdr))))) continue;
    const [name, ...embedded] = splitDba(clean(row(col.name)).replace(/\s+/g, ' '));
    if (!name) continue;
    const dbaField = col.dba ? clean(row(col.dba)).split(/[;\n]/).flatMap((s) => splitDba(clean(s).replace(/\s+/g, ' '))) : [];
    const dbas = [...embedded, ...dbaField].map(clean).filter((s) => s && !NOT_A_DBA.test(s));

    let id = index.get(legalKey(name));
    let b = id && out.get(id);
    if (!b) {
      const base = slugify(name);
      if (!base) continue;
      id = base;
      for (let i = 2; out.has(id); i++) id = `${base}-${i}`;
      b = newBroker(id, name);
      out.set(id, b);
      index.set(legalKey(name), id);
    }
    for (const n of [name, ...dbas]) if (n !== b.name) addUnique(b.aliases, n);

    b.registries = { ...Object.fromEntries(REGISTRY_KEYS.map((k) => [k, null])), ...b.registries, [state]: year };
    if (b.optOut === null || b.optOut === undefined) b.optOut = optOutFrom(row, col);
    if (!b.website && col.website) { const w = firstUrl(row(col.website)); if (w) b.website = w; }

    const kinds = new Set(b.kind);
    for (const [hdr, kind] of Object.entries(col.flags ?? {})) if (/^yes$/i.test(clean(row(hdr)))) kinds.add(kind);
    if (col.category) {
      const k = CATEGORY_MAP[state]?.[clean(row(col.category)).toLowerCase()];
      if (k) kinds.add(k);
    }
    b.kind = sortKinds([...kinds]);
    addUnique(b.sources, sourceId);
  }
  return out;
}

// ---------- CLI ----------
async function main(argv) {
  const { readFile, writeFile, readdir, mkdir, unlink } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join, resolve } = await import('node:path');
  const [state, csvPath, date, archived] = argv;
  if (!COLUMN_MAPS[state] || !csvPath || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    console.error('usage: node import-registry.js <CA|TX|OR|VT> <csvPath> <YYYY-MM-DD> [archivedUrl]');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const brokersDir = join(root, 'brokers');
  await mkdir(brokersDir, { recursive: true });

  const sourceId = `registry-${state.toLowerCase()}-${date}`;
  const sourcesPath = join(root, 'sources.json');
  const sources = JSON.parse(await readFile(sourcesPath, 'utf8'));
  if (!sources[sourceId]) {
    if (!archived) { console.error(`${sourceId} is not in sources.json yet: pass its Wayback capture as archivedUrl`); process.exit(2); }
    sources[sourceId] = { ...REGISTRY_META[state], archived, kind: 'registry', accessed: date };
  } else if (archived) sources[sourceId].archived = archived;
  await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);

  const existing = new Map();
  for (const f of (await readdir(brokersDir)).filter((f) => f.endsWith('.json')).sort()) {
    const b = JSON.parse(await readFile(join(brokersDir, f), 'utf8'));
    existing.set(b.id, b);
  }
  const rows = parseCsv(await readFile(resolve(csvPath), 'utf8'));
  const merged = importRows(state, rows, existing, sourceId);
  let written = 0;
  for (const [id, b] of merged) {
    const text = `${JSON.stringify(b, null, 2)}\n`;
    if (existing.has(id) && JSON.stringify(existing.get(id), null, 2) + '\n' === text) continue;
    await writeFile(join(brokersDir, `${id}.json`), text);
    written++;
  }
  let removed = 0;
  for (const id of existing.keys()) if (!merged.has(id)) { await unlink(join(brokersDir, `${id}.json`)); removed++; }
  const cands = mergeCandidates(merged.values());
  const md = [
    '# Merge candidates',
    '',
    'Generated by `build/import-registry.js`; do not edit by hand. Each pair shares a DBA, brand or alias',
    'but has a different legal name, so the import keeps them as separate records. The research pass',
    'decides whether each pair is one broker, a parent and subsidiary (`parent`), or unrelated.',
    '',
    `${cands.length} pairs.`,
    '',
    '| Record A | Record B | Shared string | Registries A | Registries B |',
    '|---|---|---|---|---|',
    ...cands.map((c) => `| ${c.a} | ${c.b} | ${c.shared.replace(/\|/g, '\\|')} | ${c.registriesA} | ${c.registriesB} |`),
    '',
  ].join('\n');
  await writeFile(join(root, 'sources', 'registries', 'MERGE-CANDIDATES.md'), md);
  const touched = [...merged.values()].filter((b) => b.sources.includes(sourceId)).length;
  console.log(`${state} ${date}: ${touched} brokers in registry, ${merged.size - existing.size} new, ${written} files written, ${removed} merged away, ${cands.length} merge candidates`);

  const { errors, counts } = await validateDataset(root);
  for (const e of errors) console.error(e);
  console.log(`brokers: ${counts.brokers} links: ${counts.links} published: ${counts.published} sources: ${counts.sources}`);
  if (errors.length) process.exit(1);
}

const { fileURLToPath: f2p } = await import('node:url');
if (process.argv[1] && f2p(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) await main(process.argv.slice(2));
