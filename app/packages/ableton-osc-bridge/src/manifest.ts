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
