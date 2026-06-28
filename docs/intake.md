# Intake survey

The absurdist DMV-style intake form. Implemented one-to-one in
`app/packages/shared/src/survey.ts` (the single source of truth that drives `/intake`).
Visitors have no name field — they're identified by ticket number (the form stores the
number as the `name`). Every answer is stored as a string in `freeText`, keyed by field id.

1. Month of Birth — *short text*
2. Location of Birth — *short text*
3. Eye Color — *short text*
4. Occupation — *short text*
5. What brought you here today? — *long text*
6. Rate your level of passive aggressiveness on a scale of 1-5 — *1–5 scale*
   (1 = "Straight shooter (not passive aggressive at all)" … 5 = "Repressed misfires (very passive)")
7. What is the texture of your tenderness? — *choose one + Other*
   (Crosshatching · Mic on Teeth · Popped Bubblewrap · Styrofoam Flaking · Barnacle · Frayed rope · Lego block)
8. What is something you are confident that you know? — *long text*
9. What is something that you are confident you don't know? — *long text*
10. How often do you currently back up your data? — *choose one*
    (Continuously · More than once per day · Daily · Weekly · Less often than weekly · Never)
11. How often do you cry? — *choose one + Other*
    (Continuously · More than once per day · Daily · Weekly · Less often than weekly · Never)
12. Please choose three phrases from below to BEST describe a close relationship you are in
    with either a friend, family member, partner or co-worker — *choose many*
    (Chewing gum · Legendary Emulation · Sync Wheel · Clothespin in Wind · Timing Belt Squeal Song · Stiletto Lawn Walk · Dry Lightning)
13. What is your shoe size? — *short text*
14. Did you bring water? — *choose one* (Yes · No)
15. Please touch a body part. Enter what you touched — *short text*
16. What is a happy memory you have? — *long text*
17. How does AI make you feel? — *long text*
18. Please choose one option to complete the sentence — "The mood of my current week could be
    described as…" — *choose one*. **This answer directly affects the sonic landscape.**
    (Basement Riser · Moody Sky · Disco Love · Excited Drive)
19. If you could know the answer to any question, what would it be? — *long text*

## Physical challenges (handled at the scan stations, not the form)
- Please proceed to the scanning station and take the shape of your spirit animal for processing.
- Please proceed to the next scanning station and place the images in their correct place.
