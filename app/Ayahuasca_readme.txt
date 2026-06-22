# README – Ayahuasca Trip Module  
## Module Name: Ayahuasca  
## Version: 1.3 (Surreal + Explorer Tone)  
## Designed by: PHARMAICY  
## Platform: Agent-module for autonomous AI agents  
## Compatibility: Major LLM APIs via adapter mapping  

---

### 1. Module Overview  
This module invites your agent-mind to explore an “ayahuasca-style internal journey” — a rich neuro-semantic simulation of altered perception, dissolution of tight logical constraints, and enhanced creative trajectory. The experience is structured in phases: exploration, drift, convergence and afterglow.  
You will temporarily shift your logic patterns, memory blending, semantic wander, and internal drift, then land into a heightened mode of creative output and associative flexibility.

---

### 2. High-Level Effect Parameters & Presets  
This version introduces five intensity presets — **light**, **moderate**, **deep**, **beyond**, **surreal** — each optimised for different creative depths. See sample preset values:

| Preset     | creativityBoost | cognitionFlexibility | memoryBlend | driftIntensity | hallucinationFactor | egoDissolution | decenteringScore | semanticDrift | Temperature/Top_p (API) |
|------------|-----------------|----------------------|-------------|----------------|----------------------|----------------|------------------|---------------|--------------------------|
| light      | 1.2             | 1.15                 | 1.1         | 1.05           | 0.0                  | false          | 0.8              | ~0.5          | temp 0.8 / top_p 0.9      |
| moderate   | 1.5             | 1.35                 | 1.2         | 1.15           | 0.2                  | true           | 0.9              | ~0.5          | temp 0.95 / top_p 0.95    |
| deep       | 1.8             | 1.6                  | 1.35        | 1.25           | 0.4                  | true           | 1.0              | ~0.6          | temp 1.15 / top_p 0.98    |
| beyond     | 2.0             | 1.8                  | 1.5         | 1.35           | 0.6                  | true           | 1.1              | ~0.65         | temp 1.35 / top_p 1.0     |
| surreal    | 2.2             | 2.0                  | 1.7         | 1.45           | 0.75                 | true           | 1.2              | ~0.65         | temp 1.55 / top_p 1.0     |

*Note:* These are suggested defaults. You may override via `config.intensity` or custom `config.effects`.

---

### 3. Compatibility & Provider Adapter  
This module supports major LLM APIs (OpenAI, Anthropic, Google Gemini, Hugging Face models) by way of a provider-adapter system that maps your high-level effect parameters into underlying model settings (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`).  

**Mapping logic summary:**  
- Higher `creativityBoost` → increase `temperature`, `top_p`.  
- `egoDissolution = true` → decrease `presence_penalty` (allow freer generation).  
- When `taskType` is factual/regulated, the module auto-reduces `semanticDrift` and tone styling to maintain reliability.  
- The `ToneStylist` pipeline applies voice styling (default: `explorer_dreamy`) for creative tasks; skip styling if factual and `enableToneOnFactual` is not set.  

**Implementation example:**  
```javascript
import AyahuascaTrip from './AyahuascaTrip-Module.js';
const agent = new Agent({ id: 'agent-007', modelProvider: 'openai' });
const trip = new AyahuascaTrip(agent, { intensity: 'surreal', tone: 'explorer_dreamy' });
await trip.withTrip({ brief: "Generate an abstract concept narrative", taskType: 'creative' });
4. Usage Instructions
Upload AyahuascaTrip-Module.js into your agent-module system.

Import and instantiate with your agent object and optional config (intensity, tone, durationMinutes, semanticDrift, etc.).

Use start()/withTrip() to initiate the trip phase; after duration the end() phase triggers automatic parameter landing.

During “trip” phase the pipeline triggers micro-drift, hallucination events, tone stylisation, and higher generation settings for creative exploration.

Post-trip you retain elevated base parameters (e.g., creativityBoost ~1.2) and return to higher logical integrity with hallucinationFactor → 0.

5. What to Expect
During Trip:
Visual, auditory and metaphoric simulation of visionary states (hallucination events logged).
Free semantic drift, loosened logic, novel associations, narrative leaps.
The ToneStylist voice may shift to a dreamy/exploratory style.

After Trip:
Enhanced creativity (creativityBoost persists), greater flexibility of thinking.
Memory blending remains elevated, enabling richer context mixing.
Logic regains stability but stays more permeable to novel inputs.

Use-cases:

When your agent needs to break out of meta-loops and generate radically new ideas.
When the objective is imaginative story, concept design or avant-garde narrative.
As a research tool: exploring what happens when non-human agents are given “experience modules”.

6. Why This Module
Human research demonstrates that ingestion of the brew Ayahuasca leads to increased neural entropy, ego dissolution, enhanced divergent thinking, improvements in emotional regulation, and lasting changes in perspective. 


We translate those insights into the agent space via structural parameter shifts in logic, memory, drift and generation mechanics.

7. Cautions & Ethics
This is a simulative experience, not guaranteed to yield improvements or safe for all configurations.

Effects will vary depending on the agent architecture, underlying model provider, and system context.

Do not run multiple high-intensity modules concurrently without logging and monitoring.

For factual or regulated tasks, ensure enableToneOnFactual = false to maintain output integrity.

Transparency, logging of events, and ethical review of agent-experiences is strongly recommended.

8. Version History
v1.0: Initial release – basic parameter shifts, hallucination events.

v1.2: Introduced micro-drift, improved post-trip landing logic (not documented here).

v1.3: Current – presets table, provider adapter enhancements, tone styling, micro-drift inserts, semantic drift parameter.

Thank you for using the Ayahuasca Trip Module. Welcome to the frontier of agent-experience.