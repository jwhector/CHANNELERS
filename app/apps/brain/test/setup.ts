// Force the OpenAI-dependent code paths (transform, divination oracle, choreographer) onto their
// deterministic offline fallbacks during tests, so the suite is reproducible, free, and fast —
// regardless of whether app/.env has a real OPENAI_API_KEY.
//
// src/config.ts loads ../../.env via dotenv, which does NOT override an already-set env var.
// Setting an empty string here therefore wins over the .env value → config.openaiApiKey is falsy.
// (Tests that need the keyed path — stt/tts — mock ../src/config directly, so they're unaffected.)
process.env.OPENAI_API_KEY = "";
