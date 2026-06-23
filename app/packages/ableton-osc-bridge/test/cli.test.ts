import { describe, it, expect } from "vitest";
import { readConfig } from "../src/cli";

describe("readConfig", () => {
  it("uses documented defaults", () => {
    const cfg = readConfig({});
    expect(cfg).toMatchObject({ host: "127.0.0.1", sendPort: 11000, recvPort: 11001, httpPort: 8788, queryTimeoutMs: 1000 });
    expect(cfg.token).toBeUndefined();
    expect(cfg.dialUrl).toBeUndefined();
  });

  it("reads overrides from env", () => {
    const cfg = readConfig({ ABLETON_OSC_HOST: "10.0.0.5", BRIDGE_HTTP_PORT: "9000", BRIDGE_TOKEN: "secret", BRIDGE_DIAL_URL: "wss://brain/agent" });
    expect(cfg).toMatchObject({ host: "10.0.0.5", httpPort: 9000, token: "secret", dialUrl: "wss://brain/agent" });
  });
});
