# Altered-State Console — parameter reference

The operator-only control panel on **`/channel`** (the **ALTERED STATE** collapsible). It tunes how
the oracle generates, live, during a divination — derived from the PHARMAICY "Ayahuasca" module.
No audience screen shows it; it's a mixing desk for the AI's voice.

**Implementation:** controls + values live in [`packages/shared/src/tuning.ts`](../app/packages/shared/src/tuning.ts);
the brain holds one global tuning ([`apps/brain/src/tuning.ts`](../app/apps/brain/src/tuning.ts)) and
applies it in [`divination.ts`](../app/apps/brain/src/divination.ts) + [`transform.ts`](../app/apps/brain/src/transform.ts).
Design notes: [`docs/superpowers/specs/2026-06-21-altered-state-console.md`](superpowers/specs/2026-06-21-altered-state-console.md).

## How it works at a glance

- **One global tuning.** There's a single live config shared by every session, not per-visitor. Edit
  it on any `/channel` screen and every screen syncs (it rides `tuning.set` / `tuning.state` WS
  messages, kept off the OSC/show-event contract).
- **Presets seed editable values.** Picking a preset (light → surreal) *loads* the module's verbatim
  numbers into the sliders. From there you edit freely — touching any sampling/effect slider flips
  the label to **custom**. The brain only ever reads the concrete numbers, never the label.
- **Default = today's behavior.** Out of the box the tuning is `baseline` (temperature 1, everything
  else neutral, pipeline off) — identical to how the oracle behaved before this panel existed.
- **Only the API's hard limits are enforced.** Sliders clamp to ranges OpenAI accepts (so a request
  never 400s); there's no taste-based cap. A `⚠ word-salad zone` marker appears above temperature
  1.3 as a *non-blocking* hint that gpt-4o output gets hard to speak past there.

---

## Presets (intensity)

Buttons: **light · moderate · deep · beyond · surreal · reset**. Each loads a bundle of sampling +
effects + drift/hallucination values, copied verbatim from `Ayahuasca_v1.3.js`. **reset** returns to
`baseline` (today's behavior). Higher presets = wilder, looser, more dissolved.

| preset   | temp | top_p | presence | frequency | creativityBoost | egoDissolution | hallucination | semanticDrift |
|----------|------|-------|----------|-----------|-----------------|----------------|---------------|---------------|
| light    | 0.80 | 0.90  | 0.0      | 0.0       | 1.2             | off            | 0.0           | 0.50          |
| moderate | 0.95 | 0.95  | −0.1     | 0.0       | 1.5             | on             | 0.2           | 0.50          |
| deep     | 1.15 | 0.98  | −0.2     | −0.05     | 1.8             | on             | 0.4           | 0.60          |
| beyond   | 1.35 | 1.00  | −0.35    | −0.10     | 2.0             | on             | 0.6           | 0.65          |
| surreal  | 1.55 | 1.00  | −0.45    | −0.15     | 2.2             | on             | 0.75          | 0.65          |

A preset only sets the numbers — it does **not** turn on the text pipeline or `effectsDriveSampling`.
Those are independent switches you flip yourself (see below). So "surreal" alone just means hot
sampling; to get the full trip you also enable the effects-drive and/or pipeline toggles.

---

## Sampling — the real OpenAI knobs

These map 1:1 to the parameters sent to the model. This is the part that genuinely, mechanically
changes generation.

- **temperature** (0–2) — randomness. Low (~0.7) = focused, repeatable, "safe." High (>1.2) =
  surprising, associative, eventually incoherent. gpt-4o stays speakable up to ~1.3; past that it
  drifts toward word salad (hence the warning marker). The oracle's old hardcoded value was **1**.
- **top_p** (0–1) — nucleus sampling: the model samples only from the most-likely tokens whose
  probabilities sum to `top_p`. 1.0 = consider everything; 0.5 = only the safest half. It's a second
  way to widen/narrow the candidate pool. **Tip:** temperature and top_p both control "wildness" and
  interact — turn one at a time so you can tell what's doing what.
- **presence_penalty** (−2 to 2) — pushes the model toward *new* topics. **Positive** = discourages
  reusing any token it has already used (more topic-hopping). **Negative** = the opposite: rewards
  staying on the same words/themes, so it gets loopier and more incantatory. The presets use negative
  values, which makes the oracle circle and repeat — atmospheric, but note it's *not* "more creative"
  the way the module's readme implies.
- **frequency_penalty** (−2 to 2) — like presence, but scaled by how *often* a token has appeared.
  **Positive** = suppresses verbatim repetition. **Negative** = encourages chant-like repetition.
- **max_tokens** (16–2000) — hard cap on reply length. The oracle ships at **300** (a few spoken
  sentences). Lower = terser; higher = room to ramble. *(This applies to the oracle only — the seeds
  transform always uses 1024 so its JSON has room.)*

---

## Effects — the module's vocabulary

The "ayahuasca" knobs. **By themselves they're just labels** — logged, displayed, but inert — *unless*
you turn on **drive sampling**.

- **drive sampling** (toggle, `effectsDriveSampling`) — when **on**, ports the module's own mapping
  so the effect knobs nudge the real sampling params:
  - `temperature += (creativityBoost − 1) × 0.25`
  - `top_p += (creativityBoost − 1) × 0.1`
  - if `egoDissolution` is on → `presence_penalty` is forced to at most −0.25
  - (results are then clamped to valid ranges)

  So with drive-sampling on, "surreal" (creativityBoost 2.2) adds **+0.30** to temperature on top of
  its base 1.55. When **off**, what you see on the sampling sliders is exactly what's sent.
- **creativityBoost** (0–5) — the main dial that feeds the temperature/top_p nudge above.
- **egoDissolution** (toggle) — when drive-sampling is on, clamps presence toward repetition (−0.25).
- **cognitionFlexibility, memoryBlend, driftIntensity, decenteringScore** (0–5) — pure flavor/telemetry
  at the moment; they don't feed the sampling math. `decenteringScore` *does* appear in the prompt-drift
  directive text (below). Leave them as scene-setting unless/until we wire more of the mapping.
- **hallucinationFactor** (0–1) — used by the prompt-drift directive: above 0 it adds a "permit
  visionary non-sequiturs" line to the system prompt (only when **promptDrift** is on).

---

## Text pipeline — the theatrical layer

Two ways to push the *style* further than sampling alone. **Both default off.** They deliberately
fight the carefully-built persona voice and anti-slop deny-list, so they're opt-in experiments.

- **promptDrift** (toggle) — the gentle, LLM-native option. Appends an `[ALTERED PERCEPTION]` block to
  the oracle's system prompt asking it to loosen, wander, and speak in fragmented sensory images. Its
  wording scales with **semanticDrift** and **decenteringScore**; if **hallucinationFactor > 0** it
  also invites brief "impossible images." The model still writes coherent text in its own voice — it's
  just instructed to trip. **Recommended starting point.**
- **outputMangle** (toggle) — the destructive option. Takes the *finished* reply and runs it through
  the module's regex text-manglers (adjective injection, metaphor splicing, dreamy asides). Because it
  has to see the whole reply before transforming it, **it buffers — the teleprompter stops streaming
  word-by-word and the line appears all at once.** It will visibly corrupt the persona's phrasing.
  Results are deterministic per turn (same input → same mangle).
- **tone** (none · explorer_dreamy) — only affects `outputMangle`. `explorer_dreamy` injects sensory
  adjectives ("luminous," "velvet") and curious asides into the mangled text. `none` skips that stage.
- **semanticDrift** (0–1) — how hard `outputMangle` fires: it's the probability strength for the
  sensory-paint and metaphor passes. 1.0 ≈ transform every eligible word; 0 ≈ leave most alone. Also
  feeds the promptDrift wording.
- **hallucinationBudget** (0–1) — under `outputMangle` + `explorer_dreamy`, raises the chance of
  inserting "what-if" tangents and (with microDrift) detour asides.
- **microDrift** (toggle) — under `outputMangle` + `explorer_dreamy`, sprinkles small parenthetical
  detours ("(a small detour—curiosity often finds doors)") into the text.

---

## Scope — where the dials point

- **apply to oracle** (toggle, default **on**) — the live divination loop honors the tuning. Turn it
  **off** to run the oracle at baseline regardless of the dials (handy for an A/B against a tweaked
  transform).
- **apply to seeds transform** (toggle, default **off**) — also aim the *sampling* (temperature, top_p,
  penalties) at the intake→seeds transform, so a visitor's music/dance seeds come out weirder. The
  transform needs valid JSON; if a high temperature breaks the JSON, the brain already falls back to
  the deterministic stub seeds, so it degrades safely rather than erroring. The text pipeline and
  max_tokens do **not** apply here.

---

## Practical recipes

- **Subtle strangeness, still reliable:** preset `moderate`, leave pipeline off. Pure sampling shift.
- **A real "trip," readable:** preset `deep`, turn on **promptDrift**, keep temperature ≤ ~1.3. The
  oracle drifts in its own voice and still streams.
- **Maximum dissolution (demo/experiment):** preset `surreal` + **drive sampling** on + **promptDrift**
  on + **outputMangle** on (`explorer_dreamy`, semanticDrift ~0.7). Expect non-streaming, half-garbled,
  very on-theme output that mostly ignores the persona.
- **Weird seeds, normal oracle:** turn **apply to oracle** off, **apply to seeds transform** on, bump
  temperature, watch the music/dance seeds get stranger while readings stay grounded.

## Caveats worth remembering

- Negative presence/frequency penalties make the oracle **more repetitive**, not more inventive — the
  module's framing of this as "freer generation" is misleading. Use them for incantatory texture.
- It's one global config: changing it mid-show affects whoever is being channelled right then.
- `outputMangle` is the only control that breaks live streaming. If a performer relies on the
  word-by-word teleprompter, prefer `promptDrift`.
