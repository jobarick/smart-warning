# Tanzania emergency numbers: evidence and verification

Checked 2026-10-16; 199 and 117 re-checked 2026-10-17. The same evidence is in code (`server/emergency-numbers.js`, `TZ_EVIDENCE`), is served with each number by `/api/emergency/directory`, and is shown under the number in the app (level, date checked, source link).

**No number is "official" yet.** That level is reserved for written confirmation from TCRA or the responsible agency. Changes: 199 relabelled "Health line (Afya)" (2026-10-16); on 2026-10-17 the home grid's Health button moved from 117 to 199, and 117 was removed from the app (evidence below). No other number was added, removed or changed.

## Levels

| Level | Meaning |
|---|---|
| official | Confirmed in writing by TCRA or the responsible agency. **None yet.** |
| government-listed | Listed on an official Tanzanian government website: the Government portal or the agency's own site. Strong evidence, but not a written confirmation. |
| corroborated | Consistent reports from UN agencies or the operator. |
| reported | Press, guides or foreign sources only. |
| unconfirmed | Looked for; no supporting source found. Shown with a warning and "if it does not connect, call 112". |

The key source is the Government portal's list **"Namba za Dharura"** on <https://www.tanzania.go.tz/topics/health>. It reads: "Kuzuia Uhalifu 111, Polisi 112, Rushwa 113, Zimamoto na Uokoaji 114, Gari la Wagonjwa m-mama 115, Dawati la Jinsia na Watoto 116, Afya 199, Zanzibar 190".

## Per number

| Number | Organisation and service | Scope | Free | Level | Evidence | Open questions |
|---|---|---|---|---|---|---|
| 112 | Tanzania Police Force: police emergencies | National | Life-and-safety codes are exempt from charging under the TCRA numbering plan | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health); [TCRA numbering FAQ](https://www.tcra.go.tz/faq/frequent-asked-questions-on-numbering) ("112 for police") | Reported patchy outside Dar es Salaam ([Trek Medics](https://trekmedics.org/database/tanzania-2/)) |
| 111 | Police: crime prevention (Kuzuia Uhalifu) | National | As above | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health); [TCRA signalling plan](https://www.tcra.go.tz/uploads/text-editor/files/National%20Signalling%20Point%20Codes%20Plan%20(Updated%20June,%202020)_1622553236.pdf) lists the Police call centre on 111/112 | |
| 113 | TAKUKURU / PCCB: report corruption | Mainland. In Zanzibar, 113 is advertised by [ZAECA](https://zaeca.go.tz/), a separate body | Yes ("namba ya bure", TAKUKURU regional office) | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health); [Shinyanga region site](https://shinyanga.go.tz/new/takukuru-yajipanga-kuongeza-uelewa-kwa-wadau-kuhusu-rushwa-na-madhara-yake-kabla-na-baada-ya-uchaguzi-wa-mwaka-2024) | Earlier status "unconfirmed" is superseded |
| 114 | Tanzania Fire and Rescue Force (Jeshi la Zimamoto na Uokoaji) | National, routed to the nearest station | Yes, all networks, 24 h (Parliament record 2015; Morogoro region notice) | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health); [zimamoto.go.tz](https://www.zimamoto.go.tz/) ("Piga simu Namba: 114") | Press reports patchy by region or network. zimamoto.go.tz refused automated access on 2026-10-16 |
| 115 | Ministry of Health, M-mama: emergency transport for pregnant women and newborns | Mainland and Zanzibar | Yes in Zanzibar (Zanzibar MoH); Mainland not stated | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health) ("Gari la Wagonjwa m-mama"); [MoH news](https://www.moh.go.tz/en/news-single/dharura-zaidi-60000-zasafirishwa-kupitia-mfumo-wa-m-mama); [Mwananchi, launch March 2024](https://www.mwananchi.co.tz/mw/habari/kitaifa/-namba-115-ya-simu-ya-dharura-suluhisho-vifo-vya-wajawazito-yazinduliwa-tanzania-4568530) | **Not a general ambulance service everywhere.** The app's "Ambulance" link uses 115 because no other public ambulance line was found; ask MoH whether 115 accepts non-maternal emergencies |
| 116 | Gender and children desk / National Child Helpline (C-Sema with the Government) | Mainland and Zanzibar | Yes, 24/7 (UN agencies) | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health) ("Dawati la Jinsia na Watoto"); [UNFPA](https://www.unfpa.org/news/tanzanian-helpline-reaching-thousands-risk-women-and-girls-every-day); [UN News](https://news.un.org/en/node/1091972) | |
| 199 | Ministry of Health Afya Call Centre: health advice and information. **Not an ambulance**; the app's text sends a medical emergency to 112 or 115 | National | Yes, 24/7 ([VillageReach](https://www.villagereach.org/resource/enhancing-the-effectiveness-of-afya-call-center-hotline-199-complaints-and-feedback-system/)) | government-listed | [Ministry of Health, 4 July 2024](https://www.moh.go.tz/en/news-single/mhe-ummy-ahimiza-watumishi-afya-call-centre-199-kuongeza-ufanisi-kuhudumia-wananchi) ("Afya Call Centre 199", the Ministry's centre for receiving and answering citizens' questions); [Government portal](https://www.tanzania.go.tz/topics/health) ("Afya 199") | Now the home grid's Health button (was 117) |
| 190 | Zanzibar / disaster alerts | Zanzibar; national scope unclear | Yes (GFDRR) | government-listed | [Government portal](https://www.tanzania.go.tz/topics/health) ("Zanzibar 190"); [World Bank GFDRR](https://www.gfdrr.org/en/feature-story/assessment-action-how-tanzania-strengthening-emergency-preparedness) | Ask PMO Disaster Management Department whether 190 works on the Mainland |
| 119 | Drug Control and Enforcement Authority (DCEA) | National | Yes ("Piga Simu Bure 119") | government-listed | [dcea.go.tz](https://www.dcea.go.tz/) | |
| 195 | Ministry of Home Affairs: Counter Trafficking in Persons call centre | National | Yes (toll free) | reported | [The Citizen, 25 May 2026](https://www.thecitizen.co.tz/tanzania/news/national/tanzania-rescues-trafficking-victims-from-gulf-asia-5472380) | Not found on a government site |
| 110 | Maritime rescue: Lake Victoria and other water bodies | Lakes | Toll free (reported) | reported | [EACO harmonised short codes](https://eaco.int/admin/docs/publications/EACO%20HARMONISED%20SHORT%20CODE.PDF); [Kenya News, Jan 2026](https://www.kenyanews.go.ke/eac-eyes-safer-lake-victoria-as-mwanza-maritime-rescue-centre/) | Mwanza rescue centre takes 110 calls "once fully operational": **may not answer yet** |
| 117 | Was labelled "Health" | ? | ? | **unconfirmed** | None found | **Removed from the app 2026-10-17**: no official or credible source supports it, and the Ministry of Health and [Government portal](https://www.tanzania.go.tz/topics/health) give 199. Its evidence record stays in code; restore it only if TCRA or the Ministry confirm it |
| 181 | DAWASA, Dar es Salaam water | Dar es Salaam | ? | unconfirmed | None found | Confirm with DAWASA |
| 0800110064 | Labelled "Disaster Management (Mainland)" | Mainland | Toll-free range | unconfirmed | None found | Confirm with PMO Disaster Management Department; on the home grid |
| 0800711113 | Labelled "Utility Emergency" | ? | Toll-free range | unconfirmed | None found | Unknown operator; on the home grid. Consider removing, or replacing with TANESCO's published line once confirmed |

## What a government listing does and does not prove

"Government-listed" means an official Tanzanian government website names the number for that service. It does **not** prove that:

- the line is answered right now, 24 hours a day,
- it works on every network, or in every region,
- the call is free everywhere, unless the source says so, or
- the service behind it will respond to an emergency at a given location.

Only written confirmation from the responsible agency moves a number to "official", and even that is no guarantee of a response. The app therefore always keeps 112 first and says "If one does not connect, call 112."

## Requests for information (ready to send; not sent)

Nothing has been sent and no reply has been received. Send from your own email. Email addresses are given only where the agency's own website shows them (checked 2026-10-16 and 17). For the others, use the contact form or address on the agency's official site, or deliver by hand.

Suggested subject for all: **Request to confirm emergency numbers shown in the Smart Warning safety app**

### 1. TCRA (dawatilahuduma@tcra.go.tz; toll free 0800 008272)

> Dear Sir/Madam,
>
> Idefenda Lab, Dar es Salaam, develops Smart Warning, a safety and emergency alert app for people and organisations in Tanzania. The app shows emergency numbers to the public. Before we describe any number as officially confirmed, we would like to check it against the National Numbering Plan.
>
> For each of the following short codes, could you please confirm: (a) the organisation it is assigned to, (b) the service, (c) whether it works nationwide (Mainland, Zanzibar or both) and on all networks, and (d) whether calls are free of charge?
>
> 110, 111, 112, 113, 114, 115, 116, 119, 190, 195, 199
>
> We would also be grateful for a working link to the current National Numbering Plan: the June 2024 document link on your website returned an error when we tried it.
>
> Thank you for your help.
>
> Yours faithfully,
> [Your name], Idefenda Lab, Dar es Salaam
> +255 713 455 454 / +255 682 371 771, jobarick@gmail.com

### 2. Ministry of Health (ps@afya.go.tz)

> Dear Permanent Secretary,
>
> Idefenda Lab develops Smart Warning, a safety app used in Tanzania. We want the health numbers it shows to be correct. Could the Ministry please confirm:
>
> 1. 199 (Afya Call Centre): is it the right number for the public to call for health advice? Is it free and available 24 hours?
> 2. 115 (M-mama): does it accept any medical emergency needing transport, or only emergencies of pregnant women and newborns? In which regions does it operate?
> 3. Is 117 a Ministry of Health line? (We have removed it from the app until we have confirmation.)
>
> Yours faithfully, [Your name], Idefenda Lab, +255 713 455 454, jobarick@gmail.com

### 3. Prime Minister's Office, Disaster Management Department (address on pmo.go.tz)

> Is 0800 110 064 the Department's line for the public, and is it free? Does 190 reach disaster services on the Mainland as well as Zanzibar? Is there another number the public should use to report a disaster?

### 4. Tanzania Fire and Rescue Force (114; headquarters Dodoma +255 26 2320043; regional addresses on zimamoto.go.tz)

> Could you confirm that 114 is free on all networks and routed to the nearest station in every region? Could you also share the addresses or map locations of your stations in Geita, Iringa, Lindi, Mbeya, Njombe, Pwani, Rukwa, Ruvuma, Shinyanga, Singida and Songwe? None is shown on public maps, and we want to show people their nearest station.

### 5. Kikosi cha Zimamoto na Uokozi Zanzibar

> Could you share the location of your Wete (Mnazimmoja) station, and of any stations in Micheweni, Chake Chake and Mkoani? Which number should people on Pemba call for fire and rescue?

### 6. Zanzibar Ministry of Health (address on mohz.go.tz)

> Could you share the location of Wete District Hospital, and confirm the names and types (hospital, health centre, dispensary) of the North Pemba facilities listed in the attached coverage report (docs/DIRECTORY_COVERAGE.md, Kaskazini Pemba)?

### 7. DAWASA

> Is 181 DAWASA's number for water and sewerage emergencies in Dar es Salaam, and is it free?

### 8. Drug Control and Enforcement Authority (cg@dcea.go.tz; 119)

> Your website lists 119 as free. Could you confirm it works on all networks, 24 hours, and is the right number for the public to report drug-related emergencies?

### 9. Ministry of Home Affairs (Counter Trafficking in Persons call centre)

> Press reports (The Citizen, 25 May 2026) give 195 as your toll-free line. Could you confirm the number, its hours and whether it is free on all networks?

When a reply arrives, record it here (date, sender, what it confirms) and change that number's level to "official" in `server/emergency-numbers.js` (`TZ_EVIDENCE`).
