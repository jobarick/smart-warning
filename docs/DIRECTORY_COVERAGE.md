# Nationwide emergency facilities: coverage report

Generated from `server/data/tz-facilities.json` (built 2026-10-16, 7084 records). Source: OpenStreetMap via HOT exports (snapshot 2026-10-07). **Every record is unverified open data.** Counts show what is mapped, not what exists: a zero means "not in the map data", never "no such service".

## National totals

| Health | Police | Fire | Pharmacy | TANESCO | TAKUKURU |
|---|---|---|---|---|---|
| 4311 | 417 | 26 | 2322 | 7 | 1 |

## By region

| Region | Part | Health | Police | Fire | Pharmacy | TANESCO | TAKUKURU | Districts with no health facility | Districts with no police |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Arusha | Mainland | 239 | 25 | 1 | 59 | 0 | 0 | 0 of 7 | 0 of 7 |
| Dar-es-salaam | Mainland | 523 | 121 | 6 | 1091 | 7 | 1 | 0 of 3 | 0 of 3 |
| Dodoma | Mainland | 389 | 16 | 3 | 49 | 0 | 0 | 0 of 7 | 5 of 7 |
| Geita | Mainland | 76 | 9 | 0 | 10 | 0 | 0 | 0 of 5 | 2 of 5 |
| Iringa | Mainland | 79 | 3 | 0 | 42 | 0 | 0 | 0 of 5 | 2 of 5 |
| Kagera | Mainland | 242 | 31 | 4 | 88 | 0 | 0 | 0 of 8 | 1 of 8 |
| Kaskazini Pemba | Zanzibar | 0 | 0 | 0 | 0 | 0 | 0 | 2 of 2 | 2 of 2 |
| Kaskazini Unguja | Zanzibar | 19 | 6 | 1 | 10 | 0 | 0 | 0 of 2 | 0 of 2 |
| Katavi | Mainland | 32 | 3 | 0 | 13 | 0 | 0 | 0 of 3 | 1 of 3 |
| Kigoma | Mainland | 179 | 17 | 1 | 72 | 0 | 0 | 0 of 8 | 0 of 8 |
| Kilimanjaro | Mainland | 240 | 12 | 1 | 9 | 0 | 0 | 0 of 7 | 2 of 7 |
| Kusini Pemba | Zanzibar | 15 | 1 | 0 | 2 | 0 | 0 | 0 of 2 | 1 of 2 |
| Kusini Unguja | Zanzibar | 23 | 7 | 1 | 8 | 0 | 0 | 0 of 2 | 0 of 2 |
| Lindi | Mainland | 56 | 1 | 0 | 7 | 0 | 0 | 0 of 6 | 5 of 6 |
| Manyara | Mainland | 101 | 3 | 1 | 9 | 0 | 0 | 0 of 6 | 4 of 6 |
| Mara | Mainland | 323 | 41 | 1 | 121 | 0 | 0 | 0 of 7 | 2 of 7 |
| Mbeya | Mainland | 182 | 5 | 0 | 77 | 0 | 0 | 1 of 6 | 3 of 6 |
| Mjini Magharibi | Zanzibar | 68 | 14 | 1 | 84 | 0 | 0 | 0 of 2 | 0 of 2 |
| Morogoro | Mainland | 215 | 18 | 0 | 74 | 0 | 0 | 0 of 7 | 3 of 7 |
| Mtwara | Mainland | 54 | 7 | 1 | 1 | 0 | 0 | 0 of 7 | 3 of 7 |
| Mwanza | Mainland | 359 | 20 | 1 | 228 | 0 | 0 | 0 of 7 | 1 of 7 |
| Njombe | Mainland | 41 | 2 | 0 | 1 | 0 | 0 | 1 of 6 | 4 of 6 |
| Pwani | Mainland | 11 | 10 | 0 | 11 | 0 | 0 | 1 of 7 | 4 of 7 |
| Rukwa | Mainland | 30 | 5 | 0 | 2 | 0 | 0 | 1 of 4 | 1 of 4 |
| Ruvuma | Mainland | 43 | 2 | 0 | 1 | 0 | 0 | 1 of 6 | 4 of 6 |
| Shinyanga | Mainland | 147 | 10 | 0 | 26 | 0 | 0 | 0 of 5 | 1 of 5 |
| Simiyu | Mainland | 170 | 3 | 1 | 40 | 0 | 0 | 0 of 5 | 3 of 5 |
| Singida | Mainland | 110 | 4 | 0 | 12 | 0 | 0 | 0 of 6 | 3 of 6 |
| Songwe | Mainland | 68 | 1 | 0 | 3 | 0 | 0 | 1 of 5 | 4 of 5 |
| Tabora | Mainland | 190 | 10 | 1 | 38 | 0 | 0 | 0 of 7 | 3 of 7 |
| Tanga | Mainland | 87 | 10 | 1 | 134 | 0 | 0 | 1 of 10 | 6 of 10 |

## Gaps

- Regions with **no mapped health facility**: Kaskazini Pemba
- Regions with **no mapped police**: Kaskazini Pemba
- Regions with **no mapped fire station** (15 of 31): Geita, Iringa, Kaskazini Pemba, Katavi, Kusini Pemba, Lindi, Mbeya, Morogoro, Njombe, Pwani, Rukwa, Ruvuma, Shinyanga, Singida, Songwe
- Categories with **no records at all**: disaster management offices, coast guard / lake rescue stations (beyond 15 marine police), ambulance bases, child protection / social welfare offices, human trafficking response offices, water utility offices. The HOT exports keep only `amenity`, `shop`, `tourism` and `man_made` tags, so `office=*`, `emergency=*` and phone numbers are not in the source at all.
- Only 1 TAKUKURU office and 7 TANESCO offices are tagged in a way this import can recognise.
- Districts with neither a mapped health facility nor police (7 of 170): Micheweni (Kaskazini Pemba), Wete (Kaskazini Pemba), Chunya (Mbeya), Njombe (Njombe), Namtumbo (Ruvuma), Songwe (Songwe), Handeni Mji (Tanga)

## What this means in the app

Where nothing is mapped, the app says so and points to the national number. It never widens the search silently to show something far away as if it were near.

