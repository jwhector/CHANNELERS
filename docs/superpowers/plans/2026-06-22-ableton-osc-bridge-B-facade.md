# `ableton-osc-bridge` — Plan B: Comprehensive Typed Facade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan A complete (the `VerbProvider` seam, `AbletonLive`, `AbletonBridgeClient`, daemon all exist and tests pass).

**Goal:** A comprehensive, fully typed facade over the whole AbletonOSC surface — `createLive(provider)` → `await live.track(2).volume.get()`, `live.clip(0,0).fire()`, `live.song.beat.subscribe(cb)` — codegen'd from a curated manifest, with emitted JSDoc (doc + OSC address) for first-class autocomplete. Works identically over the local core and the network client (it depends only on `VerbProvider`).

**Architecture:** A hand-curated `manifest.ts` (data: every object/property/method) is the single source of truth. `scripts/generate-facade.ts` reads it and emits `src/facade/generated.ts` (concrete classes) — committed, with a test guarding that the committed output matches a fresh run. `createLive(provider)` wraps the generated `Live` root and adds a `raw.*` escape hatch. Generic verbs (Plan A) remain underneath for the few irregular endpoints the facade won't type.

**Tech Stack:** Same as Plan A. The manifest, generator, generated facade, and `createLive` are all **browser-safe** (depend only on `transport.ts`), so the facade is exported from both the main and `/client` entries.

## Global Constraints

- **Facade is browser-safe:** `manifest.ts`, `scripts/generate-facade.ts` output, `src/facade/**` import only from `../transport` — no `node:*`, no `node-osc`. (The generator *script* may use `node:fs` since it runs at build time, never imported by the package.)
- **Generated file is committed** and regenerated via `pnpm --filter ableton-osc-bridge generate`. A guard test fails if it drifts.
- **Uniform generation rules** (from spec §5):
  - value lives at reply index `idParams.length` (ids echoed first); scalar = that index, array = `slice(idParams.length)`.
  - getter → `query(get_addr, idArgs)`; setter → `send(set_addr, [...idArgs, value])`; method → `send(method_addr, [...idArgs, ...params])`; listener → `subscribe(start_listen_addr, idArgs)`.
  - `boolean` ↔ `1`/`0` both directions; `int` is documentation-only (TS type `number`).
  - snake_case OSC names → camelCase TS members.
  - `OscArg = string | number` only on the wire.
- **TDD throughout.** **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Manifest schema + seed

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/manifest.ts`
- Test: `app/packages/ableton-osc-bridge/test/manifest.test.ts`

**Interfaces:**
- Produces: types `ValueType`, `IdParam`, `PropSpec`, `MethodSpec`, `ChildSpec`, `ObjectSpec`, `RootSpec`; consts `OBJECTS: Record<string, ObjectSpec>` and `ROOT: RootSpec`.

- [ ] **Step 1: Write the failing test** — `test/manifest.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { OBJECTS, ROOT } from "../src/manifest";

describe("manifest", () => {
  it("declares the core object kinds", () => {
    for (const k of ["song", "view", "application", "track", "clip", "clipSlot", "scene", "device", "deviceParameter"]) {
      expect(OBJECTS[k], k).toBeDefined();
    }
  });

  it("song is a singleton with tempo (get/set/listen) and a startPlaying method", () => {
    const song = OBJECTS.song;
    expect(song.singleton).toBe(true);
    expect(song.props.tempo).toMatchObject({ osc: "tempo", type: "number", get: true, set: true, listen: true });
    expect(song.methods?.startPlaying).toMatchObject({ osc: "start_playing" });
  });

  it("track carries a trackId and exposes clip/device/clipSlot children", () => {
    const track = OBJECTS.track;
    expect(track.idParams).toEqual([{ name: "trackId", tsType: "number | string" }]);
    expect(track.children?.map((c) => c.accessor).sort()).toEqual(["clip", "clipSlot", "device"]);
  });

  it("root exposes singletons + track/scene factories", () => {
    expect(ROOT.singletons.map((s) => s.accessor).sort()).toEqual(["application", "song", "view"]);
    expect(ROOT.factories.find((f) => f.accessor === "track")).toBeTruthy();
  });

  it("every prop has at least one of get/set/listen", () => {
    for (const [k, obj] of Object.entries(OBJECTS)) {
      for (const [p, spec] of Object.entries(obj.props)) {
        expect(spec.get || spec.set || spec.listen, `${k}.${p}`).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test manifest`
Expected: FAIL — cannot find `../src/manifest`.

- [ ] **Step 3: Implement `src/manifest.ts`** (schema + seed; this is the curated data)

```ts
/**
 * Curated manifest of the AbletonOSC surface — the single source of truth for the
 * generated facade. Transcribed from docs/AbletonOSC-readme.md. SEED below covers the
 * common surface; Task 4 completes it. Pure data; browser-safe.
 */
export type ValueType = "number" | "int" | "boolean" | "string" | "number[]" | "string[]";

export interface IdParam {
  name: string;
  /** TS type for the id parameter (track ids may be "master"/return prefixes). */
  tsType: "number" | "string" | "number | string";
}
export interface PropSpec {
  osc: string;          // OSC property path under the namespace, e.g. "tempo" or "parameter/value"
  type: ValueType;
  get?: boolean;
  set?: boolean;
  listen?: boolean;
  doc?: string;
}
export interface MethodSpec {
  osc: string;          // OSC method, e.g. "start_playing", "fire"
  params?: { name: string; type: ValueType }[];
  doc?: string;
}
export interface ChildSpec {
  accessor: string;     // method name on the parent class, e.g. "clip"
  object: string;       // key into OBJECTS
  idParam: IdParam;     // the single new id the child adds
}
export interface ObjectSpec {
  className: string;
  osc: string;          // OSC namespace segment, e.g. "song", "clip_slot"
  idParams: IdParam[];  // ids carried by this object (echoed in replies)
  singleton?: boolean;  // exposed as a property on Live, not a factory
  props: Record<string, PropSpec>;
  methods?: Record<string, MethodSpec>;
  children?: ChildSpec[];
}
export interface RootSpec {
  singletons: { accessor: string; object: string }[];
  factories: { accessor: string; object: string; idParams: { name: string; tsType: string }[] }[];
}

const T = (name: string, tsType: IdParam["tsType"]): IdParam => ({ name, tsType });

export const OBJECTS: Record<string, ObjectSpec> = {
  application: {
    className: "Application", osc: "application", idParams: [], singleton: true,
    props: {
      version: { osc: "version", type: "string", get: true, doc: "Live version (major, minor)" },
    },
  },

  song: {
    className: "Song", osc: "song", idParams: [], singleton: true,
    methods: {
      startPlaying: { osc: "start_playing", doc: "Start session playback" },
      stopPlaying: { osc: "stop_playing", doc: "Stop session playback" },
      continuePlaying: { osc: "continue_playing", doc: "Resume session playback" },
      stopAllClips: { osc: "stop_all_clips", doc: "Stop all clips from playing" },
      tapTempo: { osc: "tap_tempo", doc: "Mimic a tap of Tap Tempo" },
      createAudioTrack: { osc: "create_audio_track", params: [{ name: "index", type: "int" }], doc: "Create an audio track (-1 = end)" },
      createMidiTrack: { osc: "create_midi_track", params: [{ name: "index", type: "int" }], doc: "Create a MIDI track (-1 = end)" },
      createScene: { osc: "create_scene", params: [{ name: "index", type: "int" }], doc: "Create a scene (-1 = end)" },
      deleteScene: { osc: "delete_scene", params: [{ name: "sceneIndex", type: "int" }], doc: "Delete a scene" },
      deleteTrack: { osc: "delete_track", params: [{ name: "trackIndex", type: "int" }], doc: "Delete a track" },
      undo: { osc: "undo", doc: "Undo the last operation" },
      redo: { osc: "redo", doc: "Redo the last undone operation" },
    },
    props: {
      tempo: { osc: "tempo", type: "number", get: true, set: true, listen: true, doc: "Song tempo (BPM)" },
      isPlaying: { osc: "is_playing", type: "boolean", get: true, listen: true, doc: "Whether the song is playing" },
      metronome: { osc: "metronome", type: "boolean", get: true, set: true, listen: true, doc: "Metronome on/off" },
      loop: { osc: "loop", type: "boolean", get: true, set: true, listen: true, doc: "Whether the song is looping" },
      currentSongTime: { osc: "current_song_time", type: "number", get: true, set: true, listen: true, doc: "Current song time, in beats" },
      signatureNumerator: { osc: "signature_numerator", type: "int", get: true, set: true, listen: true, doc: "Time signature numerator" },
      signatureDenominator: { osc: "signature_denominator", type: "int", get: true, set: true, listen: true, doc: "Time signature denominator" },
      beat: { osc: "beat", type: "int", listen: true, doc: "Current beat number (listen only)" },
      numTracks: { osc: "num_tracks", type: "int", get: true, doc: "Number of tracks" },
      numScenes: { osc: "num_scenes", type: "int", get: true, doc: "Number of scenes" },
      trackNames: { osc: "track_names", type: "string[]", get: true, doc: "All track names" },
    },
  },

  view: {
    className: "View", osc: "view", idParams: [], singleton: true,
    props: {
      selectedScene: { osc: "selected_scene", type: "int", get: true, set: true, listen: true, doc: "Selected scene index" },
      selectedTrack: { osc: "selected_track", type: "int", get: true, set: true, listen: true, doc: "Selected track index" },
    },
  },

  track: {
    className: "Track", osc: "track", idParams: [T("trackId", "number | string")],
    methods: { stopAllClips: { osc: "stop_all_clips", doc: "Stop all clips on the track" } },
    children: [
      { accessor: "clip", object: "clip", idParam: T("clipId", "number") },
      { accessor: "clipSlot", object: "clipSlot", idParam: T("clipIndex", "number") },
      { accessor: "device", object: "device", idParam: T("deviceId", "number") },
    ],
    props: {
      name: { osc: "name", type: "string", get: true, set: true, listen: true, doc: "Track name" },
      volume: { osc: "volume", type: "number", get: true, set: true, listen: true, doc: "Track volume (0–1)" },
      panning: { osc: "panning", type: "number", get: true, set: true, listen: true, doc: "Track panning (-1–1)" },
      mute: { osc: "mute", type: "boolean", get: true, set: true, listen: true, doc: "Track mute" },
      solo: { osc: "solo", type: "boolean", get: true, set: true, listen: true, doc: "Track solo" },
      arm: { osc: "arm", type: "boolean", get: true, set: true, listen: true, doc: "Track arm" },
      color: { osc: "color", type: "int", get: true, set: true, listen: true, doc: "Track color" },
      playingSlotIndex: { osc: "playing_slot_index", type: "int", get: true, listen: true, doc: "Currently-playing slot index" },
      firedSlotIndex: { osc: "fired_slot_index", type: "int", get: true, listen: true, doc: "Currently-fired slot index" },
      numDevices: { osc: "num_devices", type: "int", get: true, doc: "Number of devices on the track" },
    },
  },

  clip: {
    className: "Clip", osc: "clip", idParams: [T("trackId", "number | string"), T("clipId", "number")],
    methods: {
      fire: { osc: "fire", doc: "Start clip playback" },
      stop: { osc: "stop", doc: "Stop clip playback" },
    },
    props: {
      name: { osc: "name", type: "string", get: true, set: true, doc: "Clip name" },
      color: { osc: "color", type: "int", get: true, set: true, doc: "Clip color" },
      length: { osc: "length", type: "number", get: true, doc: "Clip length, in beats" },
      isPlaying: { osc: "is_playing", type: "boolean", get: true, doc: "Whether the clip is playing" },
      isRecording: { osc: "is_recording", type: "boolean", get: true, doc: "Whether the clip is recording" },
      gain: { osc: "gain", type: "number", get: true, set: true, doc: "Clip gain" },
      pitchCoarse: { osc: "pitch_coarse", type: "int", get: true, set: true, doc: "Coarse re-pitch (semitones)" },
      muted: { osc: "muted", type: "boolean", get: true, set: true, doc: "Clip muted state" },
      playingPosition: { osc: "playing_position", type: "number", get: true, listen: true, doc: "Clip playing position" },
    },
  },

  clipSlot: {
    className: "ClipSlot", osc: "clip_slot", idParams: [T("trackIndex", "number | string"), T("clipIndex", "number")],
    methods: {
      fire: { osc: "fire", doc: "Fire play/pause of the clip slot" },
      createClip: { osc: "create_clip", params: [{ name: "length", type: "number" }], doc: "Create a clip in the slot" },
      deleteClip: { osc: "delete_clip", doc: "Delete the clip in the slot" },
    },
    props: {
      hasClip: { osc: "has_clip", type: "boolean", get: true, doc: "Whether the slot has a clip" },
    },
  },

  scene: {
    className: "Scene", osc: "scene", idParams: [T("sceneId", "number")],
    methods: { fire: { osc: "fire", doc: "Trigger the scene" } },
    props: {
      name: { osc: "name", type: "string", get: true, set: true, doc: "Scene name" },
      color: { osc: "color", type: "int", get: true, set: true, doc: "Scene color" },
      isEmpty: { osc: "is_empty", type: "boolean", get: true, doc: "Whether the scene is empty" },
      isTriggered: { osc: "is_triggered", type: "boolean", get: true, doc: "Whether the scene is triggered" },
      tempo: { osc: "tempo", type: "number", get: true, set: true, doc: "Scene tempo" },
    },
  },

  device: {
    className: "Device", osc: "device", idParams: [T("trackId", "number | string"), T("deviceId", "number")],
    children: [{ accessor: "parameter", object: "deviceParameter", idParam: T("parameterId", "number") }],
    props: {
      name: { osc: "name", type: "string", get: true, doc: "Device name" },
      className: { osc: "class_name", type: "string", get: true, doc: "Device class name (e.g. Operator)" },
      type: { osc: "type", type: "int", get: true, doc: "1=audio_effect, 2=instrument, 4=midi_effect" },
      numParameters: { osc: "num_parameters", type: "int", get: true, doc: "Number of parameters" },
      parametersName: { osc: "parameters/name", type: "string[]", get: true, doc: "All parameter names" },
      parametersValue: { osc: "parameters/value", type: "number[]", get: true, doc: "All parameter values" },
    },
  },

  deviceParameter: {
    className: "DeviceParameter", osc: "device",
    idParams: [T("trackId", "number | string"), T("deviceId", "number"), T("parameterId", "number")],
    props: {
      value: { osc: "parameter/value", type: "number", get: true, set: true, listen: true, doc: "Parameter value" },
      valueString: { osc: "parameter/value_string", type: "string", get: true, doc: "Parameter value as a readable string" },
    },
  },
};

export const ROOT: RootSpec = {
  singletons: [
    { accessor: "song", object: "song" },
    { accessor: "view", object: "view" },
    { accessor: "application", object: "application" },
  ],
  factories: [
    { accessor: "track", object: "track", idParams: [{ name: "trackId", tsType: "number | string" }] },
    { accessor: "scene", object: "scene", idParams: [{ name: "sceneId", tsType: "number" }] },
    { accessor: "clipSlot", object: "clipSlot", idParams: [{ name: "trackIndex", tsType: "number" }, { name: "clipIndex", tsType: "number" }] },
  ],
};
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test manifest`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/manifest.ts app/packages/ableton-osc-bridge/test/manifest.test.ts
git commit -m "feat(bridge): AbletonOSC facade manifest (schema + seed)"
```

---

### Task 2: Generator + generated facade + drift guard

**Files:**
- Create: `app/packages/ableton-osc-bridge/scripts/generate-facade.ts`
- Create (generated, then committed): `app/packages/ableton-osc-bridge/src/facade/generated.ts`
- Test: `app/packages/ableton-osc-bridge/test/generated.test.ts`
- Modify: `app/packages/ableton-osc-bridge/package.json` (add `generate` script)

**Interfaces:**
- Consumes: `OBJECTS`, `ROOT` + manifest types.
- Produces: `generateFacadeSource(): string` (pure — used by the guard test); a `main` that writes `src/facade/generated.ts`. The generated module exports classes (`Live`, `Song`, `View`, `Application`, `Track`, `Clip`, `ClipSlot`, `Scene`, `Device`, `DeviceParameter`).

- [ ] **Step 1: Add the `generate` script to `package.json`** (`scripts`)

```json
    "generate": "tsx scripts/generate-facade.ts",
```

- [ ] **Step 2: Implement `scripts/generate-facade.ts`**

```ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OBJECTS,
  ROOT,
  type ObjectSpec,
  type PropSpec,
  type MethodSpec,
  type ValueType,
} from "../src/manifest";

const tsType = (t: ValueType): string => (t === "int" ? "number" : t);
const unwrapFn = (t: ValueType): string =>
  t === "boolean" ? "bool" : t === "string" ? "str" : t === "string[]" ? "strs" : t === "number[]" ? "nums" : "num";
const coerce = (t: ValueType, v: string): string => (t === "boolean" ? `(${v} ? 1 : 0)` : v);

function idFieldsExpr(obj: ObjectSpec): string {
  return `[${obj.idParams.map((ip) => `this.${ip.name}`).join(", ")}]`;
}

function emitProp(obj: ObjectSpec, key: string, spec: PropSpec): string {
  const base = `/live/${obj.osc}`;
  const offset = obj.idParams.length;
  const t = tsType(spec.type);
  const fn = unwrapFn(spec.type);
  const unwrap = `${fn}(a, ${offset})`;
  const parts: string[] = [];
  if (spec.get) parts.push(`get: (timeoutMs?: number): Promise<${t}> => p.query("${base}/get/${spec.osc}", id, timeoutMs).then((a) => ${unwrap}),`);
  if (spec.set) parts.push(`set: (v: ${t}): void => p.send("${base}/set/${spec.osc}", [...id, ${coerce(spec.type, "v")}]),`);
  if (spec.listen) parts.push(`subscribe: (cb: (v: ${t}) => void): Subscription => p.subscribe("${base}/start_listen/${spec.osc}", id, (a) => cb(${unwrap})),`);
  const doc = spec.doc ? `${spec.doc} · ` : "";
  return `  /** ${doc}OSC \`${base}/{get,set}/${spec.osc}\` */
  get ${key}() {
    const p = this.p; const id: OscArg[] = ${idFieldsExpr(obj)};
    return {
      ${parts.join("\n      ")}
    };
  }`;
}

function emitMethod(obj: ObjectSpec, key: string, spec: MethodSpec): string {
  const addr = `/live/${obj.osc}/${spec.osc}`;
  const params = spec.params ?? [];
  const decl = params.map((p) => `${p.name}: ${tsType(p.type)}`).join(", ");
  const extra = params.length ? ", " + params.map((p) => p.name).join(", ") : "";
  const doc = spec.doc ? `${spec.doc} · ` : "";
  return `  /** ${doc}OSC \`${addr}\` */
  ${key}(${decl}): void {
    const id: OscArg[] = ${idFieldsExpr(obj)};
    this.p.send("${addr}", [...id${extra}]);
  }`;
}

function emitChildAccessor(obj: ObjectSpec, child: NonNullable<ObjectSpec["children"]>[number]): string {
  const childClass = OBJECTS[child.object].className;
  const parentIds = obj.idParams.map((ip) => `this.${ip.name}`).join(", ");
  const lead = parentIds ? parentIds + ", " : "";
  return `  /** ${child.object} ${child.idParam.name} */
  ${child.accessor}(${child.idParam.name}: ${child.idParam.tsType}): ${childClass} {
    return new ${childClass}(this.p, ${lead}${child.idParam.name});
  }`;
}

function emitClass(obj: ObjectSpec): string {
  const ctorIds = obj.idParams.map((ip) => `private ${ip.name}: ${ip.tsType}`).join(", ");
  const ctor = obj.idParams.length ? `constructor(private p: VerbProvider, ${ctorIds}) {}` : `constructor(private p: VerbProvider) {}`;
  const members: string[] = [];
  for (const [k, m] of Object.entries(obj.methods ?? {})) members.push(emitMethod(obj, k, m));
  for (const c of obj.children ?? []) members.push(emitChildAccessor(obj, c));
  for (const [k, p] of Object.entries(obj.props)) members.push(emitProp(obj, k, p));
  return `export class ${obj.className} {
  ${ctor}
${members.join("\n\n")}
}`;
}

function emitLive(): string {
  const lines: string[] = [`  constructor(private p: VerbProvider) {}`];
  for (const s of ROOT.singletons) lines.push(`  readonly ${s.accessor} = new ${OBJECTS[s.object].className}(this.p);`);
  for (const f of ROOT.factories) {
    const decl = f.idParams.map((ip) => `${ip.name}: ${ip.tsType}`).join(", ");
    const args = f.idParams.map((ip) => ip.name).join(", ");
    lines.push(`  ${f.accessor}(${decl}): ${OBJECTS[f.object].className} { return new ${OBJECTS[f.object].className}(this.p, ${args}); }`);
  }
  lines.push(`  get master(): Track { return new Track(this.p, "master"); }`);
  lines.push(`  returnTrack(prefix: string): Track { return new Track(this.p, prefix); }`);
  lines.push(`  readonly raw = {
    send: (address: string, args?: OscArg[]): void => this.p.send(address, args),
    query: (address: string, args?: OscArg[], timeoutMs?: number): Promise<OscArg[]> => this.p.query(address, args, timeoutMs),
    subscribe: (address: string, args: OscArg[], cb: (args: OscArg[]) => void): Subscription => this.p.subscribe(address, args, cb),
  };`);
  return `export class Live {\n${lines.join("\n")}\n}`;
}

export function generateFacadeSource(): string {
  const header = `// AUTO-GENERATED by scripts/generate-facade.ts — do not edit by hand.
// Regenerate with: pnpm --filter ableton-osc-bridge generate
import type { OscArg, Subscription, VerbProvider } from "../transport";

const num = (a: OscArg[], i: number): number => Number(a[i]);
const str = (a: OscArg[], i: number): string => String(a[i]);
const bool = (a: OscArg[], i: number): boolean => Number(a[i]) === 1;
const nums = (a: OscArg[], i: number): number[] => a.slice(i).map(Number);
const strs = (a: OscArg[], i: number): string[] => a.slice(i).map(String);
`;
  const classes = Object.values(OBJECTS).map(emitClass);
  return [header, ...classes, emitLive()].join("\n\n") + "\n";
}

// --- file-writing entry (not imported by the package/tests) ---
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "src", "facade", "generated.ts");
  writeFileSync(out, generateFacadeSource());
  console.log(`wrote ${out}`);
}
```

- [ ] **Step 3: Generate the facade**

Run: `pnpm --filter ableton-osc-bridge generate`
Expected: prints `wrote …/src/facade/generated.ts`. Open the file — confirm `export class Song`, `Track`, `Live` exist with JSDoc.

- [ ] **Step 4: Typecheck the generated output**

Run: `pnpm --filter ableton-osc-bridge typecheck`
Expected: 0 errors. (If errors, fix the generator emit, regenerate, re-typecheck.)

- [ ] **Step 5: Write the drift-guard test** — `test/generated.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateFacadeSource } from "../scripts/generate-facade";

describe("generated facade", () => {
  it("committed generated.ts matches a fresh generation (run `pnpm generate`)", () => {
    const committed = readFileSync(join(__dirname, "../src/facade/generated.ts"), "utf8");
    expect(committed).toBe(generateFacadeSource());
  });
});
```

- [ ] **Step 6: Run it — verify pass**

Run: `pnpm --filter ableton-osc-bridge test generated`
Expected: PASS (committed output is current).

- [ ] **Step 7: Commit**

```bash
git add app/packages/ableton-osc-bridge/scripts/generate-facade.ts app/packages/ableton-osc-bridge/src/facade/generated.ts app/packages/ableton-osc-bridge/test/generated.test.ts app/packages/ableton-osc-bridge/package.json
git commit -m "feat(bridge): facade generator + generated object model + drift guard"
```

---

### Task 3: `createLive` + wire into entries + facade behavior tests

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/facade/index.ts`
- Modify: `app/packages/ableton-osc-bridge/src/index.ts` (re-export facade)
- Modify: `app/packages/ableton-osc-bridge/src/client/index.ts` (re-export facade — append)
- Test: `app/packages/ableton-osc-bridge/test/facade.test.ts`

**Interfaces:**
- Consumes: generated `Live`; `VerbProvider`, `OscArg`, `Subscription`.
- Produces: `createLive(provider: VerbProvider): Live`; re-exports of `Live` + all generated classes.

- [ ] **Step 1: Implement `src/facade/index.ts`**

```ts
import type { VerbProvider } from "../transport";
import { Live } from "./generated";

export * from "./generated";

/** Wrap any VerbProvider (the local core or the network client) in the typed facade. */
export function createLive(provider: VerbProvider): Live {
  return new Live(provider);
}
```

- [ ] **Step 2: Write the failing test** — `test/facade.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createLive } from "../src/facade/index";
import type { OscArg, VerbProvider, Subscription } from "../src/transport";

/** Records sends; lets a test answer queries and fire subscription events. */
function spyProvider(replies: Record<string, OscArg[]> = {}) {
  const sends: Array<{ address: string; args: OscArg[] }> = [];
  const queries: Array<{ address: string; args: OscArg[] }> = [];
  let lastSub: { address: string; args: OscArg[]; cb: (a: OscArg[]) => void } | null = null;
  const provider: VerbProvider = {
    send: (address, args = []) => sends.push({ address, args }),
    query: async (address, args = []) => { queries.push({ address, args }); return replies[address] ?? []; },
    subscribe: (address, args, cb): Subscription => { lastSub = { address, args, cb }; return { unsubscribe: () => sends.push({ address: address.replace("/start_listen/", "/stop_listen/"), args }) }; },
  };
  return { provider, sends, queries, fireSub: (a: OscArg[]) => lastSub?.cb(a), subAddr: () => lastSub?.address };
}

describe("facade", () => {
  it("method → send (no id)", () => {
    const s = spyProvider();
    createLive(s.provider).song.startPlaying();
    expect(s.sends).toContainEqual({ address: "/live/song/start_playing", args: [] });
  });

  it("no-id getter unwraps reply[0]", async () => {
    const s = spyProvider({ "/live/song/get/tempo": [120] });
    expect(await createLive(s.provider).song.tempo.get()).toBe(120);
    expect(s.queries).toContainEqual({ address: "/live/song/get/tempo", args: [] });
  });

  it("no-id setter sends the value", () => {
    const s = spyProvider();
    createLive(s.provider).song.tempo.set(128);
    expect(s.sends).toContainEqual({ address: "/live/song/set/tempo", args: [128] });
  });

  it("id'd getter sends the id and unwraps the value after it", async () => {
    const s = spyProvider({ "/live/track/get/volume": [2, 0.8] });
    expect(await createLive(s.provider).track(2).volume.get()).toBe(0.8);
    expect(s.queries).toContainEqual({ address: "/live/track/get/volume", args: [2] });
  });

  it("boolean prop coerces both directions", async () => {
    const s = spyProvider({ "/live/track/get/mute": [2, 1] });
    const track = createLive(s.provider).track(2);
    track.mute.set(true);
    expect(s.sends).toContainEqual({ address: "/live/track/set/mute", args: [2, 1] });
    expect(await track.mute.get()).toBe(true);
  });

  it("listen-only prop exposes subscribe and streams unwrapped values", () => {
    const s = spyProvider();
    const cb = vi.fn();
    createLive(s.provider).song.beat.subscribe(cb);
    expect(s.subAddr()).toBe("/live/song/start_listen/beat");
    s.fireSub([4]);
    expect(cb).toHaveBeenCalledWith(4);
  });

  it("nested method carries both ids", () => {
    const s = spyProvider();
    createLive(s.provider).track(0).clip(3).fire();
    expect(s.sends).toContainEqual({ address: "/live/clip/fire", args: [0, 3] });
  });

  it("device parameter value carries three ids", () => {
    const s = spyProvider();
    createLive(s.provider).track(1).device(0).parameter(5).value.set(0.5);
    expect(s.sends).toContainEqual({ address: "/live/device/set/parameter/value", args: [1, 0, 5, 0.5] });
  });

  it("master + return helpers pass string ids", () => {
    const s = spyProvider();
    const live = createLive(s.provider);
    live.master.mute.set(false);
    live.returnTrack("A").volume.set(0.3);
    expect(s.sends).toContainEqual({ address: "/live/track/set/mute", args: ["master", 0] });
    expect(s.sends).toContainEqual({ address: "/live/track/set/volume", args: ["A", 0.3] });
  });

  it("array getter slices the tail after the ids", async () => {
    const s = spyProvider({ "/live/device/get/parameters/name": [0, 0, "Attack", "Release"] });
    expect(await createLive(s.provider).track(0).device(0).parametersName.get()).toEqual(["Attack", "Release"]);
  });

  it("raw escape hatch passes through verbatim", () => {
    const s = spyProvider();
    createLive(s.provider).raw.send("/live/song/get/track_data", [0, 12, "track.name"]);
    expect(s.sends).toContainEqual({ address: "/live/song/get/track_data", args: [0, 12, "track.name"] });
  });
});
```

- [ ] **Step 3: Run it — verify pass** (generated facade already exists)

Run: `pnpm --filter ableton-osc-bridge test facade`
Expected: PASS (11 tests). If a property used here is absent from the seed, add it to `manifest.ts` and regenerate.

- [ ] **Step 4: Re-export the facade from both entries**

Append to `src/index.ts`:
```ts
export { createLive } from "./facade/index";
export * from "./facade/generated";
```

Append to `src/client/index.ts`:
```ts
export { createLive } from "../facade/index";
export * from "../facade/generated";
```

- [ ] **Step 5: Confirm `/client` + facade stay browser-safe** — add to `test/facade.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("facade + generated import nothing node-only", () => {
  for (const f of ["../src/facade/index.ts", "../src/facade/generated.ts"]) {
    const src = readFileSync(join(__dirname, f), "utf8");
    expect(src, f).not.toMatch(/from "node:/);
    expect(src, f).not.toMatch(/from "node-osc"/);
  }
});
```

- [ ] **Step 6: Full suite + typecheck; commit**

Run: `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: all PASS; 0 type errors.

```bash
git add app/packages/ableton-osc-bridge/src/facade/index.ts app/packages/ableton-osc-bridge/src/index.ts app/packages/ableton-osc-bridge/src/client/index.ts app/packages/ableton-osc-bridge/test/facade.test.ts
git commit -m "feat(bridge): createLive + facade wired into both entries + behavior tests"
```

---

### Task 4: Complete manifest coverage from the readme

**Files:**
- Modify: `app/packages/ableton-osc-bridge/src/manifest.ts`
- Regenerate: `src/facade/generated.ts`

**Interfaces:** no new types — extends `OBJECTS` data only.

This is bounded, mechanical data-entry: walk each table in `docs/AbletonOSC-readme.md` and add the missing `props`/`methods`/objects, using the exact `PropSpec`/`MethodSpec` shape from Task 1. The drift guard + facade tests keep you honest.

- [ ] **Step 1: Song** — add remaining Song methods (`capture_midi`, `create_return_track`, `cue_point/jump`, `jump_by`, `jump_to_next_cue`, `jump_to_prev_cue`, `duplicate_scene`, `duplicate_track`, `delete_return_track`, `trigger_session_record`, `tap_tempo`) and the remaining getters/setters (readme §"Song properties": `arrangement_overdub`, `back_to_arranger`, `can_redo`, `can_undo`, `clip_trigger_quantization`, `groove_amount`, `loop_length`, `loop_start`, `midi_recording_quantization`, `nudge_down`, `nudge_up`, `punch_in`, `punch_out`, `record_mode`, `root_note`, `scale_name`, `session_record`, `session_record_status`, `song_length`). Booleans: `arrangement_overdub`, `back_to_arranger`, `can_redo`, `can_undo`, `punch_in`, `punch_out`, `session_record`. Keep `track_names` as the only list for now (skip the bulk `track_data` — it's a `raw.*` call).

- [ ] **Step 2: View** — add `selectedClip` (get/set, type "int[]"? it returns track,scene — model as `raw` instead; skip), `selectedDevice` (skip — pair return). Add the `selected_scene`/`selected_track` already seeded; nothing else needed.

- [ ] **Step 3: Track** — add remaining getters/setters from the readme Track tables: `color_index`, `current_monitoring_state`, `fold_state`, `is_foldable`, `is_grouped`, `is_visible`, `can_be_armed`, `has_audio_input/output`, `has_midi_input/output`, `output_meter_left/right/level` (number, get+listen), and the list getters `clips/name` (string[]), `clips/length` (number[]), `clips/color` (number[]), `devices/name` (string[]), `devices/type` (number[]), `devices/class_name` (string[]). `send` (get/set with a `send_id`) is parameterized — model via `raw.*` (note it in a code comment) since it needs a second id mid-args.

- [ ] **Step 4: Clip** — add remaining: `color_index`, `is_audio_clip`, `is_midi_clip`, `is_overdubbing`, `will_record_on_start`, `loop_start`, `loop_end`, `warping` (bool), `start_marker`, `end_marker`, `pitch_fine`, `sample_length`, `start_time`, `position`, `velocity_amount`, `launch_mode` (int), `launch_quantization` (int), `ram_mode` (bool), `warp_mode` (int), `has_groove` (bool), `legato` (bool). Methods: `duplicate_loop`. (Note MIDI `get/add/remove notes` are irregular variadic — leave to `raw.*` with a comment.)

- [ ] **Step 5: ClipSlot** — add `has_stop_button` (get/set bool), `duplicate_clip_to` (method with `targetTrackIndex`, `targetClipIndex`).

- [ ] **Step 6: Scene** — add `color_index`, `tempo_enabled` (bool), `time_signature_numerator`/`denominator` (int), `time_signature_enabled` (bool); methods `fire_as_selected`, `fire_selected`.

- [ ] **Step 7: Device** — add `parameters/min` (number[]), `parameters/max` (number[]), `parameters/is_quantized` (number[]). DeviceParameter — already has `value` + `value_string`; nothing else.

- [ ] **Step 8: Regenerate + verify**

Run: `pnpm --filter ableton-osc-bridge generate && pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: generator runs; drift guard + all tests PASS; 0 type errors.

- [ ] **Step 9: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/manifest.ts app/packages/ableton-osc-bridge/src/facade/generated.ts
git commit -m "feat(bridge): complete facade manifest coverage from AbletonOSC readme"
```

---

### Task 5: README facade section + CHANGELOG

**Files:**
- Modify: `app/packages/ableton-osc-bridge/README.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Add a "Typed facade" section to `README.md`** — lead with it (it's the headline). Show `createLive(provider)` over both providers:

````md
## Typed facade (recommended)

```ts
// browser / remote
import { AbletonBridgeClient, createLive } from "ableton-osc-bridge/client";
const live = createLive(new AbletonBridgeClient("wss://venue/ws", { token }));

// same machine as Ableton
import { createAbletonLive, createLive } from "ableton-osc-bridge";
const live = createLive(createAbletonLive());

live.song.startPlaying();
live.song.tempo.set(124);
await live.track(2).volume.get();      // → number
live.track(2).mute.set(true);
live.track(0).clip(3).fire();
live.track(0).device(0).parameter(5).value.subscribe((v) => …);
live.song.beat.subscribe((n) => …);
live.raw.send("/live/song/get/track_data", [0, 12, "track.name"]); // escape hatch
```

Every member carries JSDoc with its description and OSC address — hover to discover the surface.
Anything the facade doesn't type (bulk `track_data`, MIDI note ops, `midimap`) is reachable via `live.raw.*`.
The facade is generated from `src/manifest.ts`; edit it and run `pnpm --filter ableton-osc-bridge generate`.
````

- [ ] **Step 2: Add a CHANGELOG entry** (newest on top) to `docs/CHANGELOG.md`:

```markdown
## 2026-06-22 — Built ableton-osc-bridge typed facade (Plan B)

- **What:** Added the comprehensive, fully typed facade on top of Plan A's `VerbProvider` seam: a curated `manifest.ts` of the AbletonOSC surface, a generator (`scripts/generate-facade.ts`) emitting `src/facade/generated.ts` with per-member JSDoc (doc + OSC address), `createLive(provider)`, a drift-guard test, and full coverage transcribed from the readme. `live.track(2).volume.set(…)`, `live.clip(0,0).fire()`, `live.song.beat.subscribe(…)` work identically over the local core and the network client; `live.raw.*` is the escape hatch.
- **Why:** Maximal DX so getting Ableton to behave takes minimal application-specific wiring (Jared's call; spec §2/§5).
- **Files/areas:** `app/packages/ableton-osc-bridge/src/manifest.ts`, `scripts/generate-facade.ts`, `src/facade/**`. Branch `ableton-osc-bridge`.
- **Verification:** `pnpm --filter ableton-osc-bridge test` + `typecheck` green (incl. facade behavior matrix + drift guard).
- **Docs touched:** this entry; package `README.md`.
```

- [ ] **Step 3: Commit**

```bash
git add app/packages/ableton-osc-bridge/README.md docs/CHANGELOG.md
git commit -m "docs(bridge): README typed-facade section + CHANGELOG (Plan B)"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** §5 facade (manifest Task 1; generator + generated Task 2; `createLive` + entries Task 3; full coverage Task 4), §5 generation rules (encoded in the generator Task 2 + asserted in facade tests Task 3), §13 testing (manifest, generated drift guard, facade matrix), §11 docs (README facade section Task 5). Provider-agnostic (`VerbProvider`) verified by the same tests passing with a fake provider — and by `createLive` being exported from both entries.
- **Placeholder scan:** the only deferred-to-execution content is Task 4's data-entry, which is fully specified (exact readme tables, exact `PropSpec`/`MethodSpec` shape, value types called out, guard tests enforce correctness). No logic placeholders.
- **Type consistency:** `VerbProvider`/`OscArg`/`Subscription` (Plan A `transport.ts`) used by the generated classes + `createLive`. Generated class names (`Live`, `Song`, `View`, `Application`, `Track`, `Clip`, `ClipSlot`, `Scene`, `Device`, `DeviceParameter`) are produced from `OBJECTS[*].className` and referenced consistently by `ROOT` factories/singletons and child accessors. `createLive` returns `Live` everywhere.
- **Irregular endpoints** (`track_data`, MIDI notes, `midimap`, `track/send`, paired `view` selections) are intentionally left to `live.raw.*` with comments — not silently dropped.
