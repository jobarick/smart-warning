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
| 112 | Tanzania Police Force: police emergencies | National | Life-and-safety codes are exempt from charging under the TCRA numbering plan | government-listed | Government portal; [TCRA numbering FAQ](https://www.tcra.go.tz/faq/frequent-asked-questions-on-numbering) ("112 for police") | Reported patchy outside Dar es Salaam ([Trek Medics](https://trekmedics.org/database/tanzania-2/)) |
| 111 | Police: crime prevention (Kuzuia Uhalifu) | National | As above | government-listed | Government portal; TCRA signalling plan lists the Police call centre on 111/112 | |
| 113 | TAKUKURU / PCCB: report corruption | Mainland. In Zanzibar, 113 is advertised by [ZAECA](https://zaeca.go.tz/), a separate body | Yes ("namba ya bure", TAKUKURU regional office) | government-listed | Government portal; [Shinyanga region site](https://shinyanga.go.tz/new/takukuru-yajipanga-kuongeza-uelewa-kwa-wadau-kuhusu-rushwa-na-madhara-yake-kabla-na-baada-ya-uchaguzi-wa-mwaka-2024) | Earlier status "unconfirmed" is superseded |
| 114 | Tanzania Fire and Rescue Force (Jeshi la Zimamoto na Uokoaji) | National, routed to the nearest station | Yes, all networks, 24 h (Parliament record 2015; Morogoro region notice) | government-listed | Government portal; zimamoto.go.tz ("Piga simu Namba: 114") | Press reports patchy by region or network. zimamoto.go.tz refused automated access on 2026-10-16 |
| 115 | Ministry of Health, M-mama: emergency transport for pregnant women and newborns | Mainland and Zanzibar | Yes in Zanzibar (Zanzibar MoH); Mainland not stated | government-listed | Government portal ("Gari la Wagonjwa m-mama"); [MoH news](https://www.moh.go.tz/en/news-single/dharura-zaidi-60000-zasafirishwa-kupitia-mfumo-wa-m-mama); [Mwananchi, launch March 2024](https://www.mwananchi.co.tz/mw/habari/kitaifa/-namba-115-ya-simu-ya-dharura-suluhisho-vifo-vya-wajawazito-yazinduliwa-tanzania-4568530) | **Not a general ambulance service everywhere.** The app's "Ambulance" link uses 115 because no other public ambulance line was found; ask MoH whether 115 accepts non-maternal emergencies |
| 116 | Gender and children desk / National Child Helpline (C-Sema with the Government) | Mainland and Zanzibar | Yes, 24/7 (UN agencies) | government-listed | Government portal ("Dawati la Jinsia na Watoto"); [UNFPA](https://www.unfpa.org/news/tanzanian-helpline-reaching-thousands-risk-women-and-girls-every-day); [UN News](https://news.un.org/en/node/1091972) | |
| 199 | Ministry of Health Afya Call Centre: health advice and information. **Not an ambulance**; the app's text sends a medical emergency to 112 or 115 | National | Yes, 24/7 ([VillageReach](https://www.villagereach.org/resource/enhancing-the-effectiveness-of-afya-call-center-hotline-199-complaints-and-feedback-system/)) | government-listed | [Ministry of Health, 4 July 2024](https://www.moh.go.tz/en/news-single/mhe-ummy-ahimiza-watumishi-afya-call-centre-199-kuongeza-ufanisi-kuhudumia-wananchi) ("Afya Call Centre 199", the Ministry's centre for receiving and answering citizens' questions); Government portal ("Afya 199") | Now the home grid's Health button (was 117) |
| 190 | Zanzibar / disaster alerts | Zanzibar; national scope unclear | Yes (GFDRR) | government-listed | Government portal ("Zanzibar 190"); [World Bank GFDRR](https://www.gfdrr.org/en/feature-story/assessment-action-how-tanzania-strengthening-emergency-preparedness) | Ask PMO Disaster Management Department whether 190 works on the Mainland |
| 119 | Drug Control and Enforcement Authority (DCEA) | National | Yes ("Piga Simu Bure 119") | government-listed | [dcea.go.tz](https://www.dcea.go.tz/) | |
| 195 | Ministry of Home Affairs: Counter Trafficking in Persons call centre | National | Yes (toll free) | reported | [The Citizen, 25 May 2026](https://www.thecitizen.co.tz/tanzania/news/national/tanzania-rescues-trafficking-victims-from-gulf-asia-5472380) | Not found on a government site |
| 110 | Maritime rescue: Lake Victoria and other water bodies | Lakes | Toll free (reported) | reported | EACO harmonised short codes; [Kenya News, Jan 2026](https://www.kenyanews.go.ke/eac-eyes-safer-lake-victoria-as-mwanza-maritime-rescue-centre/) | Mwanza rescue centre takes 110 calls "once fully operational": **may not answer yet** |
| 117 | Was labelled "Health" | ? | ? | **unconfirmed** | None found | **Removed from the app 2026-10-17**: no official or credible source supports it, and the Ministry of Health and Government portal give 199. Its evidence record stays in code; restore it only if TCRA or the Ministry confirm it |
| 181 | DAWASA, Dar es Salaam water | Dar es Salaam | ? | unconfirmed | None found | Confirm with DAWASA |
| 0800110064 | Labelled "Disaster Management (Mainland)" | Mainland | Toll-free range | unconfirmed | None found | Confirm with PMO Disaster Management Department; on the home grid |
| 0800711113 | Labelled "Utility Emergency" | ? | Toll-free range | unconfirmed | None found | Unknown operator; on the home grid. Consider removing, or replacing with TANESCO's published line once confirmed |

## Requests for information (drafts for the owner to send)

These are drafts for you to send from your own email. Nothing has been sent, and no confirmation has been received.

**1. TCRA** (dawatilahuduma@tcra.go.tz, toll-free 0800 008272)

> Subject: Request for confirmation of emergency short codes for a public safety app
>
> Dear Sir/Madam,
> Idefenda Lab (Dar es Salaam) develops Smart Warning, an emergency alert app for people and organisations in Tanzania. Before we show emergency numbers to the public, we would like to confirm them against the National Numbering Plan. Could you please confirm, for each of 110, 111, 112, 113, 114, 115, 116, 117, 119, 190, 195 and 199: the organisation it is assigned to, the service, whether it is nationwide (Mainland, Zanzibar or both), and whether calls are free on all networks? We would also be grateful for the current National Numbering Plan document (the June 2024 link on your site returns an error).
> Kind regards, [name], Idefenda Lab, +255 713 455 454

**2. Ministry of Health** (ps@afya.go.tz): Is 115 (M-mama) only for maternal and newborn emergencies, or does it accept any medical emergency? Is 199 the correct number for general health advice? Is 117 a Ministry of Health line?

**3. Prime Minister's Office, Disaster Management Department**: Is 0800 110 064 your line? Does 190 work on the Mainland?

**4. Tanzania Fire and Rescue Force** (114; HQ Dodoma +255 26 2320043): Please share regional fire station addresses or coordinates for Geita, Iringa, Lindi, Mbeya, Njombe, Pwani, Rukwa, Ruvuma, Shinyanga, Singida and Songwe.

**5. Kikosi cha Zimamoto na Uokozi Zanzibar**: Please share the location of the Wete (Mnazimmoja) station, and any station in Micheweni, Chake Chake and Mkoani.

**6. Zanzibar Ministry of Health**: Please share the location of Wete District Hospital, and confirm the type of the 14 North Pemba facilities listed in our coverage report.

**7. DAWASA**: Is 181 your emergency line?
