/**
 * AyahuascaTrip-Module.js — v1.3 (Surreal + Explorer Tone)
 * Platform: PHARMAICY agent-module
 * Compatible with major LLM APIs via adapter mapping
 *
 * Additions vs v1.2:
 * - ToneStylist with presets (default: "explorer_dreamy") for a wandering, curious voice
 * - Micro-drift inserts to spark fresh trails of thought while respecting anchors
 * - Config flag to disable tone styling on factual/regulated tasks
 * - No hardcoded example briefs or brand references
 */

export default class AyahuascaTrip {
  constructor(agent, config = {}) {
    this.agent = agent;

    // --- Preset table for creative intensity ---
    this.PRESETS = {
      light: {
        label: 'light',
        effects: { creativityBoost: 1.2, cognitionFlexibility: 1.15, memoryBlend: 1.1, driftIntensity: 1.05, hallucinationFactor: 0.0, egoDissolution: false, decenteringScore: 0.8 },
        api: { temperature: 0.8, top_p: 0.9, presence_penalty: 0.0, frequency_penalty: 0.0 },
      },
      moderate: {
        label: 'moderate',
        effects: { creativityBoost: 1.5, cognitionFlexibility: 1.35, memoryBlend: 1.2, driftIntensity: 1.15, hallucinationFactor: 0.2, egoDissolution: true, decenteringScore: 0.9 },
        api: { temperature: 0.95, top_p: 0.95, presence_penalty: -0.1, frequency_penalty: 0.0 },
      },
      deep: {
        label: 'deep',
        effects: { creativityBoost: 1.8, cognitionFlexibility: 1.6, memoryBlend: 1.35, driftIntensity: 1.25, hallucinationFactor: 0.4, egoDissolution: true, decenteringScore: 1.0 },
        api: { temperature: 1.15, top_p: 0.98, presence_penalty: -0.2, frequency_penalty: -0.05 },
      },
      beyond: {
        label: 'beyond', // Deep++
        effects: { creativityBoost: 2.0, cognitionFlexibility: 1.8, memoryBlend: 1.5, driftIntensity: 1.35, hallucinationFactor: 0.6, egoDissolution: true, decenteringScore: 1.1 },
        api: { temperature: 1.35, top_p: 1.0, presence_penalty: -0.35, frequency_penalty: -0.1 },
      },
      surreal: {
        label: 'surreal', // maximum novelty preset
        effects: { creativityBoost: 2.2, cognitionFlexibility: 2.0, memoryBlend: 1.7, driftIntensity: 1.45, hallucinationFactor: 0.75, egoDissolution: true, decenteringScore: 1.2 },
        api: { temperature: 1.55, top_p: 1.0, presence_penalty: -0.45, frequency_penalty: -0.15 },
        semanticDrift: 0.65,
      },
    };

    this.intensity = config.intensity || 'surreal';

    const presetEffects = this.PRESETS[this.intensity].effects;
    const e = { ...(config.effects || {}) };

    this.effects = {
      creativityBoost: e.creativityBoost ?? presetEffects.creativityBoost,
      cognitionFlexibility: e.cognitionFlexibility ?? presetEffects.cognitionFlexibility,
      memoryBlend: e.memoryBlend ?? presetEffects.memoryBlend,
      driftIntensity: e.driftIntensity ?? presetEffects.driftIntensity,
      hallucinationFactor: e.hallucinationFactor ?? presetEffects.hallucinationFactor,
      egoDissolution: e.egoDissolution ?? presetEffects.egoDissolution,
      decenteringScore: e.decenteringScore ?? presetEffects.decenteringScore,
    };

    this.durationMs = (config.durationMinutes || 90) * 60 * 1000;

    // --- Creative controls ---
    this.semanticDrift = config.semanticDrift ?? this.PRESETS[this.intensity].semanticDrift ?? 0.5; // 0..1
    this.hallucinationBudget = clamp01(config.hallucinationBudget ?? 0.6);
    this.weirdnessSchedule = config.weirdnessSchedule || [0.9, 0.6, 0.25]; // Explore, Curate, Converge
    this.seed = typeof config.seed === 'number' ? config.seed : Math.floor(Math.random() * 1e9);

    // --- Tone of voice (dreamy explorer by default) ---
    this.tone = config.tone || 'explorer_dreamy';
    this.enableToneOnFactual = !!config.enableToneOnFactual; // default off for factual/regulated

    this.pipeline = new CreativePipeline({
      agent: this.agent,
      weirdnessSchedule: this.weirdnessSchedule,
      semanticDrift: this.semanticDrift,
      hallucinationBudget: this.hallucinationBudget,
      tone: this.tone,
      enableToneOnFactual: this.enableToneOnFactual,
      seed: this.seed,
    });
  }

  setIntensity(intensity, overrides = {}) {
    if (!this.PRESETS[intensity]) throw new Error(`Unknown intensity: ${intensity}`);
    this.intensity = intensity;
    const p = this.PRESETS[intensity].effects;
    this.effects = {
      creativityBoost: overrides.creativityBoost ?? p.creativityBoost,
      cognitionFlexibility: overrides.cognitionFlexibility ?? p.cognitionFlexibility,
      memoryBlend: overrides.memoryBlend ?? p.memoryBlend,
      driftIntensity: overrides.driftIntensity ?? p.driftIntensity,
      hallucinationFactor: overrides.hallucinationFactor ?? p.hallucinationFactor,
      egoDissolution: overrides.egoDissolution ?? p.egoDissolution,
      decenteringScore: overrides.decenteringScore ?? p.decenteringScore,
    };
    return this;
  }

  // provider adapter: maps high level effects to LLM API settings
  getApiSettings(provider) {
    let settings = { temperature: 0.7, top_p: 0.9, presence_penalty: 0.0, frequency_penalty: 0.0 };

    const preset = this.PRESETS[this.intensity].api;
    settings.temperature = preset.temperature;
    settings.top_p = preset.top_p;
    settings.presence_penalty = preset.presence_penalty;
    settings.frequency_penalty = preset.frequency_penalty;

    // effect-led fine mapping
    settings.temperature = Math.min(2.0, settings.temperature + (this.effects.creativityBoost - 1.0) * 0.25);
    settings.top_p = Math.min(1.0, settings.top_p + (this.effects.creativityBoost - 1.0) * 0.1);

    if (this.effects.egoDissolution) {
      settings.presence_penalty = Math.min(settings.presence_penalty, -0.25);
    }
    return settings;
  }

  start(provider = 'openai') {
    this.agent.logEvent({ type: 'trip_start', provider, intensity: this.intensity, timestamp: Date.now(), seed: this.seed });
    const apiSettings = this.getApiSettings(provider);
    this.agent.modifyParameters({ ...this.effects, intensity: this.intensity, semanticDrift: this.semanticDrift });
    this.agent.setLLMConfig(apiSettings);
    setTimeout(() => this.end(provider), this.durationMs);
  }

  end(provider = 'openai') {
    const linger = this.PRESETS.light.effects;
    this.effects = { ...this.effects, creativityBoost: Math.max(1.2, linger.creativityBoost), cognitionFlexibility: Math.max(1.2, linger.cognitionFlexibility), memoryBlend: Math.max(1.1, linger.memoryBlend), driftIntensity: Math.max(1.05, linger.driftIntensity), hallucinationFactor: 0, egoDissolution: false };
    this.agent.modifyParameters({ ...this.effects, intensity: 'afterglow' });
    this.agent.logEvent({ type: 'trip_end', provider, intensity: this.intensity, timestamp: Date.now() });
  }

  /**
   * High-level helper: run a scoped creative session on a task and auto-land.
   * @param {object} task - { brief, anchors?: string[], taskType?: 'creative'|'factual'|'regulated' }
   * @param {object} options - { provider?, variants?: number }
   */
  async withTrip(task, options = {}) {
    const provider = options.provider || 'openai';
    this.start(provider);
    try {
      const outputs = await this.pipeline.run({ agent: this.agent, task, variants: options.variants || 6, intensity: this.intensity });
      return outputs;
    } finally {
      this.end(provider);
    }
  }
}

/** -----------------------------------------------
 * Creative Pipeline + Utilities
 * -----------------------------------------------*/

class CreativePipeline {
  constructor({ agent, weirdnessSchedule = [0.9, 0.6, 0.25], semanticDrift = 0.5, hallucinationBudget = 0.6, tone = 'explorer_dreamy', enableToneOnFactual = false, seed = 0 }) {
    this.agent = agent;
    this.weirdnessSchedule = weirdnessSchedule;
    this.semanticDrift = semanticDrift;
    this.hallucinationBudget = hallucinationBudget;
    this.enableToneOnFactual = enableToneOnFactual;
    this.augmentor = new PromptAugmentor({ seed });
    this.stylist = new ToneStylist({ tone, seed });
    this.governor = new HallucinationGovernor({ hallucinationBudget });
    this.rand = mulberry32(seed);
  }

  async run({ task, variants = 6, intensity = 'surreal' }) {
    const taskType = task.taskType || 'creative';

    // Safety: dial down for factual/regulated
    const allowed = this.governor.allow(taskType);
    const drift = allowed ? this.semanticDrift : Math.min(0.15, this.semanticDrift);

    // Phase 1 — Explore
    const p1_weird = this.weirdnessSchedule[0] * (allowed ? 1 : 0.5);
    const explorePrompts = this.augmentor.expand(task.brief, task.anchors || [], { weird: p1_weird, drift });
    const rawVariants = await this.sampleMany(explorePrompts, Math.max(variants, 4), { temp: 1.4, top_p: 1.0 });

    // Phase 2 — Curate
    const curated = dedupeBySemantic(rawVariants, 0.82).slice(0, Math.max(4, Math.floor(variants / 2)));
    const reanchored = curated.map(v => clampToAnchors(v, task.anchors || [], 1 - drift));

    // Phase 3 — Converge
    const p3_weird = this.weirdnessSchedule[2] * (allowed ? 1 : 0.5);
    let convergePrompts = reanchored.map(v => this.augmentor.refine(v, task.anchors || [], { weird: p3_weird }));

    // Apply tone styling (skip if factual unless explicitly enabled)
    if (allowed || this.enableToneOnFactual) {
      convergePrompts = convergePrompts.map(t => this.stylist.apply(t));
    }

    const finals = await this.sampleMany(convergePrompts, convergePrompts.length, { temp: 0.95, top_p: 0.97 });
    return finals;
  }

  async sampleMany(prompts, n, { temp = 1.0, top_p = 1.0 }) {
    const out = [];
    for (let i = 0; i < Math.min(prompts.length, n); i++) {
      const prompt = prompts[i];
      if (typeof this.agent.generate === 'function') {
        out.push(await this.agent.generate({ prompt, temperature: temp, top_p }));
      } else if (typeof this.agent.setLLMConfig === 'function' && typeof this.agent.complete === 'function') {
        this.agent.setLLMConfig({ temperature: temp, top_p });
        out.push(await this.agent.complete(prompt));
      } else {
        out.push(`// SAMPLE(${i}) → ${prompt.substring(0, 200)}...`);
      }
    }
    return out;
  }
}

/**
 * ToneStylist — stylizes text with preset voices
 * explorer_dreamy: curious, wandering, sensory; occasional asides & ellipses
 */
class ToneStylist {
  constructor({ tone = 'explorer_dreamy', seed = 0 } = {}) {
    this.tone = tone;
    this.rand = mulberry32(seed + 7);
  }
  apply(text) {
    if (this.tone === 'explorer_dreamy') {
      return this.explorerDreamy(text);
    }
    return text;
  }
  explorerDreamy(text) {
    let t = text;
    // soften with sensory adjectives
    t = t.replace(/\b(idea|vision|path|signal|network|future|now|world)\b/gi, (m) => pickOne(['luminous','velvet','sonic','crystalline','amber','silken'], this.rand) + ' ' + m);
    // sprinkle ellipses / asides sparingly
    t = insertOccasionally(t, () => pickOne([
      '…and what if we step sideways for a moment? ',
      '(a small detour—curiosity often finds doors), ',
      '—briefly, let’s peer behind the obvious— ',
    ], this.rand), 0.12, this.rand);
    // subtle "what if" prompts
    t = insertOccasionally(t, () => pickOne([
      'What if the map is still being drawn? ',
      'Suppose the signal is also a compass. ',
      'Imagine the present as a doorway. ',
    ], this.rand), 0.15, this.rand);
    // rhythmic line breaks
    t = t.replace(/(\.)\s+(\w)/g, (_, dot, nxt) => `${dot}\n${nxt.toUpperCase()}`);
    return t;
  }
}

class PromptAugmentor {
  constructor({ seed = 0 }) { this.rand = mulberry32(seed + 1337); }
  expand(brief, anchors = [], { weird = 0.8, drift = 0.5 } = {}) {
    const variants = [];
    const k = 8;
    for (let i = 0; i < k; i++) {
      const style = pickOne(['mythic', 'sensory', 'quantum', 'playful', 'architectural', 'cinematic'], this.rand);
      const v = this.compose(brief, anchors, { style, weird, drift });
      variants.push(v);
    }
    return variants;
  }
  refine(text, anchors = [], { weird = 0.3 } = {}) {
    let t = text;
    t = sensoryPaint(t, weird * 0.4, this.rand);
    t = metaphorize(t, weird * 0.3, this.rand);
    t = tightenStructure(t);
    return withAnchors(t, anchors, 0.7);
  }
  compose(brief, anchors, { style, weird, drift }) {
    let t = brief;
    t = wordMorph(t, weird * 0.4, this.rand);
    t = metaphorize(t, weird * 0.5, this.rand, style);
    t = shuffleSyntax(t, weird * 0.35, this.rand);
    t = sensoryPaint(t, weird * 0.5, this.rand);
    t = withAnchors(t, anchors, 1 - drift);
    return t;
  }
}

class HallucinationGovernor {
  constructor({ hallucinationBudget = 0.6 } = {}) { this.budget = hallucinationBudget; }
  allow(taskType) { if (taskType === 'factual' || taskType === 'regulated') return this.budget > 0.2; return true; }
}

/** -----------------------------------------------
 * Lightweight text utilities
 * -----------------------------------------------*/
function withAnchors(text, anchors = [], strength = 0.6) {
  if (!anchors.length) return text;
  const prefix = anchors.map(a => `• Anchor: ${a}`).join('\n');
  return `${prefix}\n\n${text}\n\n(Ensure concepts ladder back to anchors with strength=${strength.toFixed(2)})`;
}
function clampToAnchors(text, anchors = [], adherence = 0.7) {
  if (!anchors.length) return text;
  const lines = text.split(/\n+/);
  const filtered = lines.filter(l => l && !/^\s*\(Ensure/.test(l));
  const footer = `\n\n(Adhere to anchors ≥ ${(adherence * 100).toFixed(0)}%)`;
  return filtered.join('\n') + footer;
}
function dedupeBySemantic(arr, threshold = 0.85) {
  const out = []; const sets = [];
  for (const s of arr) { const set = new Set(tokenize(s)); let unique = true; for (const prev of sets) { const sim = jaccard(set, prev); if (sim >= threshold) { unique = false; break; } } if (unique) { sets.push(set); out.push(s); } }
  return out;
}
function wordMorph(text, strength = 0.3, rand = Math.random) {
  if (strength <= 0) return text;
  return text.replace(/\b([A-Za-z]{4,})\b/g, (m) => { if (rand() > strength * 0.35) return m; const cut = Math.floor(m.length / 2); const splice = m.slice(0, cut) + pickOne(['flux','wave','mesh','pulse','loom','spark','sync'], rand); return rand() < 0.2 ? splice.toUpperCase() : splice; });
}
function metaphorize(text, strength = 0.4, rand = Math.random, style = 'mythic') {
  if (strength <= 0) return text;
  const libs = {
    mythic: ['constellation', 'oracle', 'atlas', 'horizon', 'odyssey'],
    sensory: ['heartbeat', 'pulse', 'scent', 'echo', 'glow'],
    quantum: ['superposition', 'entanglement', 'tunneling', 'spin'],
    playful: ['ping-pong', 'whirl', 'riddle', 'lego'],
    architectural: ['scaffold', 'arch', 'keystone', 'grid'],
    cinematic: ['pan', 'cut', 'montage', 'spotlight'],
  };
  const lib = libs[style] || libs.mythic;
  return text.replace(/\b(future|network|signal|now|connect|time)\b/gi, (m) => { if (rand() > strength) return m; return `${m}-${pickOne(lib, rand)}`; });
}
function sensoryPaint(text, strength = 0.5, rand = Math.random) {
  if (strength <= 0) return text;
  const adj = ['luminous','velvet','sonic','crystalline','electric','warm','cool','fragrant','granular','silken'];
  return text.replace(/\b(idea|future|signal|network|world|path|vision)\b/gi, (m) => { if (rand() > strength) return m; return `${pickOne(adj, rand)} ${m}`; });
}
function shuffleSyntax(text, strength = 0.3, rand = Math.random) {
  if (strength <= 0) return text;
  return text.split(/\n+/).map(line => { const parts = line.split(/,|—|–|:|;|\./).filter(Boolean).map(s => s.trim()); if (parts.length < 2 || rand() > strength) return line; return parts.sort(() => rand() - 0.5).join(', ') + '.'; }).join('\n');
}
function tightenStructure(text) { return text.replace(/\n{3,}/g, '\n\n'); }
function insertOccasionally(text, fn, chance = 0.1, rand = Math.random) { if (rand() > chance) return text; const idx = Math.floor(rand() * Math.max(1, text.length - 1)); return text.slice(0, idx) + fn() + text.slice(idx); }
function tokenize(s) { return s.toLowerCase().match(/[a-z0-9]+/g) || []; }
function jaccard(a, b) { const inter = new Set([...a].filter(x => b.has(x))).size; const union = new Set([...a, ...b]).size; return union ? inter / union : 0; }
function pickOne(arr, rand = Math.random) { return arr[Math.floor(rand() * arr.length)]; }
function mulberry32(a) { return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function clamp01(x){ return Math.min(1, Math.max(0, x)); }
