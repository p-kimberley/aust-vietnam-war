# War Timeline: likely errors in the contact records

Found while writing the War Timeline's narratives (September 2026), by reading each month's and operation's most significant
contacts against their summaries and against the sources the narratives cite. None has been changed in the data; each needs checking
against the original records (the archival source on the contact) before it is corrected in Elasticsearch and the local database.
Contact ids are the Battle Map's (`/battlemap?incident=<id>`).

## Dates

| Contact | Recorded | Likely | Why |
|---|---|---|---|
| 977 | 1968-08-08 (operation "Long Dien") | 1968-02-08 | Its id falls among February 1968's; it is the same fight as 5792 (8 Feb 1968, B Coy 3 RAR, 9 VC killed, a radio taken), though the two give different Australian casualties (3 killed and 4 wounded, against 2 and 5) |
| 753 | 1967-12-02 (Forrest) | 1967-12-21 | The AWM (C153475) describes the same ambush (12 Pl D Coy 2 RAR, six VC, four killed) on 21 December, the trail lost "in the swamp" |
| 492, 494 | 1967-05-02 and 05-03 (Lismore) | one contact | Both tell the same story: 3 Pl A Coy 7 RAR, three enemy, the wounded man tracked with dogs and killed |
| 4658, 4709 | 1971-09-25 (Ivanhoe) | one contact | Both are the same mine strike; the data puts it in the Cam My rubber, the Anzac Portal in the Courtenay rubber |

## Units recorded wrongly or not at all

| Contact | Recorded against | The summary says | Note |
|---|---|---|---|
| 363 (Ingham, 1966-11-29) | 5 RAR | 6 RAR's Assault Pioneer Platoon | Why Ingham shows one 5 RAR contact |
| 492, 496 (Lismore) | 5 RAR | 7 RAR platoons (3 Pl A Coy, 11 Pl D Coy) | Lismore's "5 RAR: 2 contacts" |
| 2038 (1969-02-08) | 5 RAR, 11 Pl | D Company, 9 RAR | |
| 636 (Ainslie) | 161 Field Battery (NZ) | 5 Pl B Coy 7 RAR | |
| 4655 (Ivanhoe) | 4 Pl | mainly 6 Platoon | |
| 1369 | "Unknown unit" | V Company, 4 RAR (New Zealand) | |
| 10275 | "1 Bn", no unit | US 1/4 Cavalry | |
| 593, 621, 644 | none | 7 RAR's Assault Pioneers; V Company, 2 RAR | |

Also: 9 RAR contacts in December 1968 (21 that month, in Goodwood), though the AWM says 9 RAR joined Goodwood on 1 January 1969;
one 9 RAR contact in Lyre Bird in August 1968, before the battalion arrived in November; two 2 RAR contacts in Atherton (late 1969),
before its second tour began in May 1970; one 5 RAR contact in March 1966, before it arrived in April; contacts of 1965 to March 1966
credited to 1st Field Regiment, which deployed from May 1966 (the guns then were 105th Field Battery's); 14 of 8 RAR's contacts of
1970 recorded as Phoi Hop, an operation of 1971.

## Casualties that disagree with the contact's own summary

| Contact | Recorded | The summary says |
|---|---|---|
| 2752 (1969-08-06, tanks at Duc Thanh) | 4 friendly killed | no Australian casualties; feeds August 1969's total of 8 killed |
| 3151 (1969-11-19) | 4 Australians wounded | the four wounded were Regional Force soldiers |
| 3657 (1970-03-27, Townsville) | 1 friendly wounded; 3 enemy killed | no Australian casualties; the 13 "enemy" were foragers, three of them children |
| 4186 (1970-10-31) | a contact, four enemy | the official history: the platoon's own machine-gun fired by accident and the report was made up |
| 10086 | 0 wounded | two more Australians wounded |
| 10463 | 5 enemy killed | four killed |
| 746 | 2 friendly killed | "one or two" killed |
| 2135 (MAT, 1969-03-07) | 4 friendly killed | one Australian and three Vietnamese |

## Operations

- **"Horseshoe"** is a place (the hill near Dat Do, with checkpoints on the way), not an operation; its contacts run from 1967 to 1970
  (652, 811, 3746).
- **Ba Ria (903, 1 Feb 1968)** and the attack on **Fire Support Base Anderson (1005)** are filed under Coburg; Ba Ria was fought at
  home in Phuoc Tuy, and swells Coburg's figures (3 RAR's 22 contacts there).
- **Overland and Overlander** (April 1969) appear merged as Overlander; the AWM has 9 RAR's Overland on 2–10 April and Overlander on
  11–15 April.
- **Misspelt or split names:** "Thoan Thang 1" (May 1968), "OAKLEigh" (Feb 1968), "Finschhaven" (May 1970), "Concrete 1", "Cung Chung
  1", "Camden 2", "Bondi 1" and "Bondi 2", "Atherton 2". Those that are one operation can be brought together in `operations.csv`.

## Where the record and the sources differ (not necessarily errors)

The narratives give both figures where these matter. Smithfield/Long Tan (the record's 17 killed and 23 wounded; the Anzac Portal's
18 and 24); Bribie, Renmark, Overlord (the record's 11 killed; the Portal's 8 soldiers and 2 RAAF), Ivanhoe (the record's 5 killed and
dates of 20–25 Sep; the Portal's 6 and 19 Sep – 2 Oct), ESSO (the Portal puts it in August 1969, the record in June–July),
Coral–Balmoral (16 May: 7 killed in the record, 5 in the AWM and the Portal; 26 May: 16 wounded against 14), Hammersley, and many
operations' start and end dates, a day or several either way (Toan Thang 1, Goodwood, Federal, Merino, Kings Cross, Camden,
Townsville, Nathan).
