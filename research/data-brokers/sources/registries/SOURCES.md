# State data broker registry snapshots

Each file here is an official state registry, saved on the date in its name. `build/import-registry.js` turns them into `brokers/*.json`:

```
npm run brokers:import -- <CA|TX|OR|VT> research/data-brokers/sources/registries/<state>-<date>.csv <date> [waybackUrl]
```

Every broker found in a snapshot gets the source id `registry-<state>-<date>` (see `sources.json`).

| State | Snapshot | Rows | Brokers listing it |
|---|---|---|---|
| CA | `ca-2026-10-18.csv` | 603 | 603 |
| TX | `tx-2026-10-18.csv` (from `tx-2026-10-18.xlsx`) | 451 | 437 |
| OR | `or-2026-10-18.csv` | 391 | 387 |
| VT | `vt-2026-10-19.csv` (from `vt-2026-10-19.xlsx`) | 788 | 387 |

Deduped total across the four registries: **806 brokers**. Pairs that share only a DBA or brand are kept apart and listed in `MERGE-CANDIDATES.md` (generated on every import).

## California (CPPA)

- Page: https://cppa.ca.gov/data_broker_registry/ ("2026 California Data Broker Registry", last updated 7/29/2026). This covers brokers that operated in 2025 and registered in January 2026.
- Download: https://cppa.ca.gov/data_broker_registry/registry.csv (the "Download Registration Information" button). Saved unchanged, including its UTF-8 BOM.
- Wayback: https://web.archive.org/web/20260806041805/https://cppa.ca.gov/data_broker_registry/registry.csv. The Wayback digest (SHA-1, base32 `WEOORX64OOEDI56V2DZQHXCOS6TPS6OK`) matches our file byte for byte. The server's `Last-Modified` is 29 Jul 2026, so the file has not changed since that capture.
- Accessed: 2026-10-18.
- Older years are on the same page (`registry2024.csv`, `registry2025.csv`, and `complete-reg-data-brokers.csv` for 2020–2023) and are not imported.
- Notes: the opt-out column is "…primary website that contains details on how consumers can exercise their CA Consumer Privacy rights". Many brokers list several URLs separated by `; `; the import takes the first. The "primary contact email" is a general contact, not an opt-out route, so it is not used. Yes/no flags: precise geolocation maps to `location` and reproductive health care data maps to `health`. No other column maps onto a kind without guessing.

## Texas (Secretary of State)

- Page: https://www.sos.texas.gov/statdoc/data-brokers.shtml links to the registry at https://texas-sos.appianportalsgov.com/data-broker-registry ("Registry of Registered Data Brokers", 451 items).
- Download: the registry's "Export to Excel" button. It is generated in the browser and has no stable URL. We saved the export as `tx-2026-10-18.xlsx` (sha256 `6a6be31734e76dca2c04aa90c1da77d16a9c96fa6aa42af0f6dd20393139a13e`, export stamp "Oct 19, 2026 12:01 AM", which is UTC; local date 2026-10-18).
- Conversion: the one sheet was written to CSV with openpyxl (`uv run --with openpyxl`, which is not a project dependency). Every non-empty row was written as-is. The two metadata rows above the header ("Record Name:", "Exported On:") are kept; the importer finds the real header row by name.
- Wayback: https://web.archive.org/web/20261019051305/https://texas-sos.appianportalsgov.com/data-broker-registry. This is a capture of the registry page, not of the export, which cannot be archived.
- Accessed: 2026-10-18.
- Notes: the opt-out column is "Consumer Rights Link". "Categories of Data Processed and Transferred" is free text written by each broker, so it gives no kind (`kind: []`, left for the research pass).

## Oregon (DCBS Division of Financial Regulation)

- Page: https://dfr.oregon.gov/business/licensing/data-broker-registry/Pages/index.aspx, then "Opt out information", which leads to https://www4.cbs.state.or.us/exs/all/mylicsearch/index.cfm?fuseaction=main.show_main&group_id=20&profession_id=28&profession_sub_id=28000 ("Download 'Data Broker Opt Out Methods' Report").
- Download: https://www4.cbs.state.or.us/ex/shared/downtemp/dfcs_db_optout.csv. Saved unchanged.
- Wayback: https://web.archive.org/web/20261019051000/https://www4.cbs.state.or.us/ex/shared/downtemp/dfcs_db_optout.csv (saved by us; its digest `QH2TEUHHIFRX66GLRWEVPCYKHH6EDJ74` matches our file).
- Accessed: 2026-10-18.
- The same page also offers a "Data Collected" report (`dfcs_db_collected.csv`, yes/no per data type such as name, address, biometric) and a license data file. Neither is imported, because none of their columns map onto a kind.
- Notes: the opt-out website column is "OPT OUT WEBSITE". Some entries are bare domains (`Crunchbase.com`), which become `https://…`. When it is blank, "OPT OUT EMAIL" (explicitly an opt-out address) is used with method `email`.

## Vermont (Secretary of State)

- Search: https://bizfilings.vermont.gov/databrokersearch/Search (the old link https://bizfilings.vermont.gov/online/DatabrokerInquire/ now redirects to a login). Every search, even a name search, raises a reCAPTCHA ("User validation required to continue").
- Download: the official bulk file, not a mirror. The Secretary of State's office says, in a Vermont Public Records Act response posted on MuckRock, that the dataset is under "Bulk Database Download" in Online Services after logging in, with no fee. A maintainer with a bizfilings.vermont.gov account logged in, went to Online Services → Bulk Database Download, and downloaded the "Data Broker" file on 2026-10-19. It came as `Data Broker.xlsx`, saved unchanged as `vt-2026-10-19.xlsx` (sha256 `263ff5ffb883e8e71277453ee9d72ef12a71cb1a9b7188c96bcd3a02e0eeefee`). It has one sheet, "DataBroker Information", with a header row and 788 data rows.
- Conversion: the one sheet was written to `vt-2026-10-19.csv` (sha256 `a5defbb3df2cf7cd6b89ee552aa061295eb374bffc6126be2283f580848ec4fa`) with openpyxl 3.1.5 (`uv run --with openpyxl python -I`, which is not a project dependency), reading cell values (`read_only=True, data_only=True`). Every non-empty row was written as-is: all 40 columns (the last has no header), empty cells as empty strings, values not trimmed, `\n` line endings, quoting only where needed (Python's `csv` default), UTF-8 without a BOM. The file has no metadata rows above the header.
- Wayback: https://web.archive.org/web/20261019163716/https://bizfilings.vermont.gov/databrokersearch/Search (saved by us). This is a capture of the public search page, not of the bulk file: the file is only served after logging in, so it has no public URL and cannot be archived. To check our copy, download the same file with your own account and compare it with the SHA-256 above (a later download will differ as registrations change).
- Accessed: 2026-10-19.
- Rows: the file has one row per applicant contact, so a broker can appear on several rows (788 rows, 520 registration numbers, 503 distinct names). It also keeps lapsed registrations: `DataBrokerStatus` is "Registered" on 633 rows (all expiring 2/1/2027) and "Unregistered" on 155 (147 expired 2/1/2026). Only "Registered" rows are imported (`onlyWhere` in `COLUMN_MAPS.VT`), which gives 387 brokers. 115 names appear only on "Unregistered" rows and are not imported.
- Notes: the opt-out column is "OptOutMethod", a free-text answer to how consumers opt out. It is used only when the whole answer is a URL or an email address; prose is never mined for links, so most Vermont answers give no route and Vermont-only records mostly have `optOut: null`. "IspersonalinformationOptOut" (True/False) is not turned into `method: "none"`. "EmailAddress" is the broker's general contact, not an opt-out route, so it is not used. The website is "PrimaryInterneturl". Vermont has no data-category column, so it gives no kind (`kind: []`, `CATEGORY_MAP.VT` is empty). The file also names each registration's applicant (name, email, phone, address), as the Texas export names a contact person; those columns are not imported into records.

## How the import decides things

- **Matching:** two rows are the same broker only when their legal names match after `normalizeName` (suffixes such as LLC/Inc/Limited dropped, `&` read as "and"), also ignoring spaces ("BEEN VERIFIED" = "BeenVerified"). A legal name with an embedded "d/b/a", "dba" or "doing business as" (common in TX) is split into the legal name and a DBA first. DBAs and other spellings become `aliases`, but a shared DBA or alias never merges two records, even within one registry and even when one row names both. Those pairs go to `MERGE-CANDIDATES.md` for the research pass, which decides between same broker, parent/subsidiary (`parent`) and unrelated.
- **Opt-out:** set only when the field is a URL (or a list made only of URLs), giving `{method:'web-form', url, status:'unchecked'}`, or an email address, giving `{method:'email', email}`. Prose is never mined for links. A blank field leaves `optOut: null`. An opt-out route that is already set is never overwritten by a later registry.
- **Kind:** only unambiguous flags (see CA). Anything else gives `kind: []`.
- **Registries:** `registries[state]` is the year of the snapshot we took (`"2026"`), not the year the broker registered. For TX in particular, the export lists every currently registered broker; a value of `"2026"` means "listed in the 2026-10-18 snapshot", even if the registration (see "Submitted On") was filed in 2024 or 2025.
