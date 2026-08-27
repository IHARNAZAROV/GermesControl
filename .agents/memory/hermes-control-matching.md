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

## Kufar feed schema
The real static Kufar feed (URL is the `kufarXmlUrl` default in
dataStore.js) is `<uedb><records><record>...</record></records></uedb>`,
not a generic `<feed><offer>`/`<ads><ad>` structure. Contract number comes
straight from `<re_contract>` (reliable). Explicit `<address>` tags are rare
(~1 in 48 records); location is otherwise only guessable from `<subject>`
(never from `<body>`, which always ends in the agency's own boilerplate
office address that would otherwise get misread as the listing's address).
