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
      captureMidi: { osc: "capture_midi", doc: "Capture MIDI" },
      createAudioTrack: { osc: "create_audio_track", params: [{ name: "index", type: "int" }], doc: "Create an audio track (-1 = end)" },
      createMidiTrack: { osc: "create_midi_track", params: [{ name: "index", type: "int" }], doc: "Create a MIDI track (-1 = end)" },
      createReturnTrack: { osc: "create_return_track", doc: "Create a return track" },
      createScene: { osc: "create_scene", params: [{ name: "index", type: "int" }], doc: "Create a scene (-1 = end)" },
      cuePointJump: { osc: "cue_point/jump", params: [{ name: "cuePoint", type: "string" }], doc: "Jump to a cue point, by name or numeric index" },
      jumpBy: { osc: "jump_by", params: [{ name: "time", type: "number" }], doc: "Jump song position by the given time, in beats" },
      jumpToNextCue: { osc: "jump_to_next_cue", doc: "Jump to the next cue marker" },
      jumpToPrevCue: { osc: "jump_to_prev_cue", doc: "Jump to the previous cue marker" },
      deleteScene: { osc: "delete_scene", params: [{ name: "sceneIndex", type: "int" }], doc: "Delete a scene" },
      deleteReturnTrack: { osc: "delete_return_track", params: [{ name: "trackIndex", type: "int" }], doc: "Delete a return track" },
      deleteTrack: { osc: "delete_track", params: [{ name: "trackIndex", type: "int" }], doc: "Delete a track" },
      duplicateScene: { osc: "duplicate_scene", params: [{ name: "sceneIndex", type: "int" }], doc: "Duplicate a scene" },
      duplicateTrack: { osc: "duplicate_track", params: [{ name: "trackIndex", type: "int" }], doc: "Duplicate a track" },
      triggerSessionRecord: { osc: "trigger_session_record", doc: "Trigger record in session mode" },
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
      arrangementOverdub: { osc: "arrangement_overdub", type: "boolean", get: true, set: true, doc: "Whether arrangement overdub is on" },
      backToArranger: { osc: "back_to_arranger", type: "boolean", get: true, set: true, doc: "Whether \"back to arranger\" is lit" },
      canRedo: { osc: "can_redo", type: "boolean", get: true, doc: "Whether redo is available" },
      canUndo: { osc: "can_undo", type: "boolean", get: true, doc: "Whether undo is available" },
      clipTriggerQuantization: { osc: "clip_trigger_quantization", type: "int", get: true, set: true, doc: "Clip trigger quantization level" },
      grooveAmount: { osc: "groove_amount", type: "number", get: true, set: true, doc: "Current groove amount" },
      loopLength: { osc: "loop_length", type: "number", get: true, set: true, doc: "Current loop length" },
      loopStart: { osc: "loop_start", type: "number", get: true, set: true, doc: "Current loop start point" },
      midiRecordingQuantization: { osc: "midi_recording_quantization", type: "int", get: true, set: true, doc: "MIDI recording quantization" },
      nudgeDown: { osc: "nudge_down", type: "number", get: true, set: true, doc: "Nudge down" },
      nudgeUp: { osc: "nudge_up", type: "number", get: true, set: true, doc: "Nudge up" },
      punchIn: { osc: "punch_in", type: "boolean", get: true, set: true, doc: "Punch in" },
      punchOut: { osc: "punch_out", type: "boolean", get: true, set: true, doc: "Punch out" },
      recordMode: { osc: "record_mode", type: "int", get: true, set: true, doc: "Current record mode" },
      rootNote: { osc: "root_note", type: "int", get: true, doc: "Current root note" },
      scaleName: { osc: "scale_name", type: "string", get: true, doc: "Current scale name" },
      sessionRecord: { osc: "session_record", type: "boolean", get: true, set: true, doc: "Whether session record is enabled" },
      sessionRecordStatus: { osc: "session_record_status", type: "int", get: true, doc: "Current session record status" },
      songLength: { osc: "song_length", type: "number", get: true, doc: "Song arrangement length, in beats" },
    },
  },

  view: {
    className: "View", osc: "view", idParams: [], singleton: true,
    // selected_clip / selected_device are paired (track_index, scene/device_index) get/set —
    // irregular shape; reach them via live.raw.*.
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
    // track/get/send and track/set/send carry a mid-args send_id (track_id, send_id, value) —
    // irregular shape; reach them via live.raw.*.
    props: {
      name: { osc: "name", type: "string", get: true, set: true, listen: true, doc: "Track name" },
      volume: { osc: "volume", type: "number", get: true, set: true, listen: true, doc: "Track volume (0–1)" },
      panning: { osc: "panning", type: "number", get: true, set: true, listen: true, doc: "Track panning (-1–1)" },
      mute: { osc: "mute", type: "boolean", get: true, set: true, listen: true, doc: "Track mute" },
      solo: { osc: "solo", type: "boolean", get: true, set: true, listen: true, doc: "Track solo" },
      arm: { osc: "arm", type: "boolean", get: true, set: true, listen: true, doc: "Track arm" },
      color: { osc: "color", type: "int", get: true, set: true, listen: true, doc: "Track color" },
      colorIndex: { osc: "color_index", type: "int", get: true, set: true, doc: "Track color index" },
      currentMonitoringState: { osc: "current_monitoring_state", type: "int", get: true, set: true, doc: "Current monitoring state (1=on, 0=off)" },
      foldState: { osc: "fold_state", type: "boolean", get: true, set: true, doc: "Folded state (for groups)" },
      isFoldable: { osc: "is_foldable", type: "boolean", get: true, doc: "Whether the track is foldable (a group)" },
      isGrouped: { osc: "is_grouped", type: "boolean", get: true, doc: "Whether the track is in a group" },
      isVisible: { osc: "is_visible", type: "boolean", get: true, doc: "Whether the track is visible" },
      canBeArmed: { osc: "can_be_armed", type: "boolean", get: true, doc: "Whether the track can be armed" },
      hasAudioInput: { osc: "has_audio_input", type: "boolean", get: true, doc: "Whether the track has audio input" },
      hasAudioOutput: { osc: "has_audio_output", type: "boolean", get: true, doc: "Whether the track has audio output" },
      hasMidiInput: { osc: "has_midi_input", type: "boolean", get: true, doc: "Whether the track has MIDI input" },
      hasMidiOutput: { osc: "has_midi_output", type: "boolean", get: true, doc: "Whether the track has MIDI output" },
      outputMeterLeft: { osc: "output_meter_left", type: "number", get: true, listen: true, doc: "Current output level, left channel" },
      outputMeterRight: { osc: "output_meter_right", type: "number", get: true, listen: true, doc: "Current output level, right channel" },
      outputMeterLevel: { osc: "output_meter_level", type: "number", get: true, listen: true, doc: "Current output level, both channels" },
      playingSlotIndex: { osc: "playing_slot_index", type: "int", get: true, listen: true, doc: "Currently-playing slot index" },
      firedSlotIndex: { osc: "fired_slot_index", type: "int", get: true, listen: true, doc: "Currently-fired slot index" },
      numDevices: { osc: "num_devices", type: "int", get: true, doc: "Number of devices on the track" },
      clipsName: { osc: "clips/name", type: "string[]", get: true, doc: "All clip names on the track" },
      clipsLength: { osc: "clips/length", type: "number[]", get: true, doc: "All clip lengths on the track" },
      clipsColor: { osc: "clips/color", type: "number[]", get: true, doc: "All clip colors on the track" },
      devicesName: { osc: "devices/name", type: "string[]", get: true, doc: "All device names on the track" },
      devicesType: { osc: "devices/type", type: "number[]", get: true, doc: "All device types on the track" },
      devicesClassName: { osc: "devices/class_name", type: "string[]", get: true, doc: "All device class names on the track" },
    },
  },

  clip: {
    className: "Clip", osc: "clip", idParams: [T("trackId", "number | string"), T("clipId", "number")],
    // get/add/remove notes are variadic MIDI-note ops — irregular; reach them via live.raw.*.
    methods: {
      fire: { osc: "fire", doc: "Start clip playback" },
      stop: { osc: "stop", doc: "Stop clip playback" },
      duplicateLoop: { osc: "duplicate_loop", doc: "Duplicate the clip's loop" },
    },
    props: {
      name: { osc: "name", type: "string", get: true, set: true, doc: "Clip name" },
      color: { osc: "color", type: "int", get: true, set: true, doc: "Clip color" },
      colorIndex: { osc: "color_index", type: "int", get: true, set: true, doc: "Clip color index (0–69)" },
      length: { osc: "length", type: "number", get: true, doc: "Clip length, in beats" },
      sampleLength: { osc: "sample_length", type: "number", get: true, doc: "Clip sample length" },
      startTime: { osc: "start_time", type: "number", get: true, doc: "Clip start time" },
      isPlaying: { osc: "is_playing", type: "boolean", get: true, doc: "Whether the clip is playing" },
      isRecording: { osc: "is_recording", type: "boolean", get: true, doc: "Whether the clip is recording" },
      isOverdubbing: { osc: "is_overdubbing", type: "boolean", get: true, doc: "Whether the clip is overdubbing" },
      isAudioClip: { osc: "is_audio_clip", type: "boolean", get: true, doc: "Whether the clip is audio" },
      isMidiClip: { osc: "is_midi_clip", type: "boolean", get: true, doc: "Whether the clip is MIDI" },
      willRecordOnStart: { osc: "will_record_on_start", type: "boolean", get: true, doc: "Whether the clip will record on start" },
      gain: { osc: "gain", type: "number", get: true, set: true, doc: "Clip gain" },
      pitchCoarse: { osc: "pitch_coarse", type: "int", get: true, set: true, doc: "Coarse re-pitch (semitones)" },
      pitchFine: { osc: "pitch_fine", type: "number", get: true, set: true, doc: "Fine re-pitch (cents)" },
      muted: { osc: "muted", type: "boolean", get: true, set: true, doc: "Clip muted state" },
      warping: { osc: "warping", type: "boolean", get: true, set: true, doc: "Whether the clip is warped" },
      loopStart: { osc: "loop_start", type: "number", get: true, set: true, doc: "Clip loop start" },
      loopEnd: { osc: "loop_end", type: "number", get: true, set: true, doc: "Clip loop end" },
      startMarker: { osc: "start_marker", type: "number", get: true, set: true, doc: "Clip start marker (beats)" },
      endMarker: { osc: "end_marker", type: "number", get: true, set: true, doc: "Clip end marker (beats)" },
      position: { osc: "position", type: "number", get: true, set: true, doc: "Clip position (LoopStart)" },
      velocityAmount: { osc: "velocity_amount", type: "number", get: true, set: true, doc: "Clip velocity amount (0.0–1.0)" },
      launchMode: { osc: "launch_mode", type: "int", get: true, set: true, doc: "Launch mode (0=Trigger, 1=Gate, 2=Toggle, 3=Repeat)" },
      launchQuantization: { osc: "launch_quantization", type: "int", get: true, set: true, doc: "Launch quantization value" },
      ramMode: { osc: "ram_mode", type: "boolean", get: true, set: true, doc: "Clip RAM mode" },
      warpMode: { osc: "warp_mode", type: "int", get: true, set: true, doc: "Warp mode (0=Beats, 1=Tones, 2=Texture, 3=Re-Pitch, 4=Complex, 6=Pro)" },
      hasGroove: { osc: "has_groove", type: "boolean", get: true, doc: "Whether the clip has a groove" },
      legato: { osc: "legato", type: "boolean", get: true, set: true, doc: "Clip legato state" },
      playingPosition: { osc: "playing_position", type: "number", get: true, listen: true, doc: "Clip playing position" },
    },
  },

  clipSlot: {
    className: "ClipSlot", osc: "clip_slot", idParams: [T("trackIndex", "number | string"), T("clipIndex", "number")],
    methods: {
      fire: { osc: "fire", doc: "Fire play/pause of the clip slot" },
      createClip: { osc: "create_clip", params: [{ name: "length", type: "number" }], doc: "Create a clip in the slot" },
      deleteClip: { osc: "delete_clip", doc: "Delete the clip in the slot" },
      duplicateClipTo: { osc: "duplicate_clip_to", params: [{ name: "targetTrackIndex", type: "int" }, { name: "targetClipIndex", type: "int" }], doc: "Duplicate the clip to an empty target slot" },
    },
    props: {
      hasClip: { osc: "has_clip", type: "boolean", get: true, doc: "Whether the slot has a clip" },
      hasStopButton: { osc: "has_stop_button", type: "boolean", get: true, set: true, doc: "Whether the slot has a stop button" },
    },
  },

  scene: {
    className: "Scene", osc: "scene", idParams: [T("sceneId", "number")],
    // scene/fire_selected takes no scene_id (operates on the selected scene) — reach it via live.raw.*.
    methods: {
      fire: { osc: "fire", doc: "Trigger the scene" },
      fireAsSelected: { osc: "fire_as_selected", doc: "Trigger the scene and select the next scene" },
    },
    props: {
      name: { osc: "name", type: "string", get: true, set: true, doc: "Scene name" },
      color: { osc: "color", type: "int", get: true, set: true, doc: "Scene color" },
      colorIndex: { osc: "color_index", type: "int", get: true, set: true, doc: "Scene color index" },
      isEmpty: { osc: "is_empty", type: "boolean", get: true, doc: "Whether the scene is empty" },
      isTriggered: { osc: "is_triggered", type: "boolean", get: true, doc: "Whether the scene is triggered" },
      tempo: { osc: "tempo", type: "number", get: true, set: true, doc: "Scene tempo" },
      tempoEnabled: { osc: "tempo_enabled", type: "boolean", get: true, set: true, doc: "Whether scene tempo is enabled" },
      timeSignatureNumerator: { osc: "time_signature_numerator", type: "int", get: true, set: true, doc: "Scene time signature numerator" },
      timeSignatureDenominator: { osc: "time_signature_denominator", type: "int", get: true, set: true, doc: "Scene time signature denominator" },
      timeSignatureEnabled: { osc: "time_signature_enabled", type: "boolean", get: true, set: true, doc: "Whether scene time signature is enabled" },
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
      parametersMin: { osc: "parameters/min", type: "number[]", get: true, doc: "All parameter minimum values" },
      parametersMax: { osc: "parameters/max", type: "number[]", get: true, doc: "All parameter maximum values" },
      parametersIsQuantized: { osc: "parameters/is_quantized", type: "number[]", get: true, doc: "Per-parameter is_quantized flags" },
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
