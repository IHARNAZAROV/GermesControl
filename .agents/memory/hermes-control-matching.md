---
name: Hermes Control cross-source matching
description: How real Сайт/ILVO/Kufar records get matched and compared without false-positive noise; read before touching src/main/compare.js, parsers.js, or schema.js in this project.
---

## Matching key
Real records from Сайт, ILVO CRM, and Kufar never share a technical ID. The
reliable join key across all three is the **contract number** (normalized —
strip "Договор №"/"от <date>" down to the core token, e.g. "1/1"). Address is
only a fallback for records missing a contract number or where it doesn't
match.

**Why:** verified directly against real exports — the vast majority of
records line up by contract number; shared IDs don't exist in any real
source.

## Field comparison must be forgiving
Comparing `city`/`address`/`title` naively (case-insensitive string equality)
produces near-100% false-positive "mismatch" rates on real data — it is not
a parsing bug, it reflects genuine cross-system conventions:
- Сайт's `city` field often uses the **district** name (e.g. "Лидский
  район"), while ILVO/Kufar use the **settlement** name (e.g. "Огородники").
  These will never textually match even though they describe the same
  object correctly.
- ILVO/Kufar addresses are frequently a shorter, cleaner subset of Сайт's
  fuller address string (e.g. "Октябрьская, 9" vs "ул. Октябрьская, 9, пос.
  Первомайский, Дубровенский сельсовет"), and house/block numbers sometimes
  have inconsistent internal spacing ("16к2" vs "16к 2").
- `title` is independently generated per source and is never expected to
  match at all.

**How to apply:** `city` and `title` are marked `compare: false` in
`OBJECT_FIELDS` (schema.js) — do not re-enable naive comparison on them.
`address` comparison in compare.js's `fieldsDiffer` uses token-subset
containment first, then a whitespace-stripped substring check, before
flagging a real mismatch — keep both checks if address comparison is ever
reworked, or the noise returns.

## Unicode normalization caveat
JavaScript `\b` is ASCII-oriented even with the `u` flag, so it is not a
reliable boundary for Cyrillic words or abbreviations such as `Договор` and
`ул`. Use explicit lookarounds or whitespace/punctuation boundaries in
normalizers.

**Why:** contract and address fixtures exposed silent failures where Cyrillic
prefixes were left in the value, preventing otherwise equivalent records from
matching.

**How to apply:** whenever changing `extractContractKey` or
`cleanLocationText`, test both Cyrillic and Latin variants instead of relying
on `\b` around Cyrillic text.

## Free-text area units
When normalizing Russian area units in descriptions, use explicit letter/digit
lookarounds. A global replacement of the standalone-looking Cyrillic `м`
without boundaries also changes words such as `дом` and can create false
numeric matches.

**Why:** ILVO descriptions mix `м²`, `м2`, and `кв. м`; an unbounded unit
replacement once transformed ordinary words before area extraction.

**How to apply:** normalize only `м²`/`м2`/standalone `м`/`кв. м`, then prefer
explicit total-area phrases before any short-form fallback.

## Price as supporting evidence
Price is a corroborating signal, not a standalone identity key. Use it to
strengthen and disambiguate an address match; without a contract or address,
require at least two strong property attributes alongside the price.

**Why:** the same price can occur for unrelated listings, while legitimate
cross-source listings can differ slightly in price and must still be grouped
so the price discrepancy is reported inside one object.

**How to apply:** keep price-only pairs separate; allow address matches with
different prices so price mismatches remain visible to the comparison report.

## Deal type provenance
`dealType` must come from an explicit source field only. In particular, an ILVO
description is free text and may mention аренда without describing the current
deal; missing deal type remains null and is not a mismatch.

**Why:** inferring `Аренда` from any occurrence of a word in `Описание` created
false discrepancies, while defaulting missing values to `Продажа` fabricated
data during imports.

**How to apply:** accept explicit deal columns/keys such as `dealType`,
`Тип сделки`, or `Операция`; normalize their Russian/English values, but never
scan descriptions or silently default an absent value.

## Descriptor fallback safety
The price-plus-attributes fallback may join records only when the prices match,
at least two strong attributes are available and all available strong
attributes agree. A known conflict in type, rooms, or total area blocks the
fallback.

**Why:** two unrelated listings can have similar prices and areas; allowing a
partial attribute match pulled a different object into an existing group and
created several downstream false errors.

**How to apply:** treat contract as the primary key and address as the normal
fallback; use descriptors only as a conservative last resort with conflict
rejection.

## Duplicate presentation keys
The normalized contract key is also the deduplication key for repeated rows
inside one source and for the contract registry itself. A source/reference ID
or a missing object link must never create a second visible row for the same
contract; the user-facing identity is the object's ordinal number and its
human-readable title.

**Why:** the same contract can arrive once as `41/1` and once as
`Договор 41/1 от <date>`, while reference IDs are absent or differ between
exports. Treating those as separate records inflated a roughly 60-object set
to 127 rows.

**How to apply:** normalize with `extractContractKey` before grouping or
building contract rows; retain technical IDs only for internal linking and
never expose them in tables or exports.

## Kufar feed schema
The real static Kufar feed (URL is the `kufarXmlUrl` default in
dataStore.js) is `<uedb><records><record>...</record></records></uedb>`,
not a generic `<feed><offer>`/`<ads><ad>` structure. Contract number comes
straight from `<re_contract>` (reliable). Explicit `<address>` tags are rare
(~1 in 48 records); location is otherwise only guessable from `<subject>`
(never from `<body>`, which always ends in the agency's own boilerplate
office address that would otherwise get misread as the listing's address).

### Subject street abbreviations
Kufar subjects can abbreviate a street with an initial and include the house
or corpus after the street, for example `по ул. Л. Чайкиной` or
`по ул. Машерова,23 корп.1`. The extractor must preserve periods inside the
street name and must not stop at the first punctuation mark.

**Why:** the first implementation treated the period after `Л.` as the end
of the address and returned only `ул. Л`, producing a false address mismatch
against the full site/ILVO address.

**How to apply:** extract the full subject suffix after `ул.`/`улица` (also
supporting `на улице` and a standalone street marker), trim only terminal
punctuation/parentheticals, and let address comparison accept a one-letter
street initial when the remaining tokens agree.

## Demo data must not leak into imports
The initial demo state includes a synthetic contract registry so the contract
checks have examples immediately. A real source import must clear demo sources,
the demo registry, and any saved report before the next check; real reports
derive contracts from the current source records instead.

**Why:** the demo generator intentionally creates hundreds of numbered
contracts, which can look like real agency data when a user imports only one
source and the old demo state remains alongside it.

**How to apply:** preserve the demo registry only when all three source
metadata records are explicitly marked as demo; never merge it into a report
for real imported data.
