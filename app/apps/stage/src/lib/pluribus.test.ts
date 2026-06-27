import { describe, expect, it } from "vitest";
import type { DispatchReady, VisitorProfile } from "@channelers/shared";
import {
  altarReadyNumbers,
  buildPluribusBroadcast,
  formatNumberList,
  readyNumbers,
} from "./pluribus";

// Minimal VisitorProfile; cast past the optional fields we don't exercise.
const v = (
  number: number,
  o: { state?: "waiting" | "called" | "in_progress"; intakeAt?: string; poseAt?: string; paperAt?: string; offeringAt?: string; sessionEndAt?: string } = {},
): VisitorProfile =>
  ({
    id: `v${number}`,
    number,
    location: { state: o.state ?? "waiting" },
    createdAt: "t",
    intakeAt: o.intakeAt,
    poseAt: o.poseAt,
    paperAt: o.paperAt,
    offeringAt: o.offeringAt,
    sessionEndAt: o.sessionEndAt,
  }) as VisitorProfile;

describe("altarReadyNumbers", () => {
  it("returns ascending numbers of waiting visitors who cleared every station and have no session end", () => {
    const ready = (n: number) => v(n, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t" });
    expect(
      altarReadyNumbers([
        ready(7),
        ready(3),
        v(5, { intakeAt: "t", poseAt: "t" }), // paper + offering not done → excluded
        v(9, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t", sessionEndAt: "t" }), // done → excluded
        v(11, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t", state: "in_progress" }), // not waiting → excluded
      ]),
    ).toEqual([3, 7]);
  });
});

describe("readyNumbers", () => {
  it("maps and sorts the dispatcher's altar-ready entries ascending", () => {
    const list: DispatchReady[] = [
      { id: "a", number: 7 },
      { id: "b", number: 3 },
    ];
    expect(readyNumbers(list)).toEqual([3, 7]);
  });
});

describe("formatNumberList", () => {
  it("formats one, two, and three-plus naturally", () => {
    expect(formatNumberList([3])).toBe("3");
    expect(formatNumberList([3, 7])).toBe("3 and 7");
    expect(formatNumberList([3, 7, 12])).toBe("3, 7, and 12");
  });
});

describe("buildPluribusBroadcast", () => {
  it("uses USER (singular) for one and the exact template", () => {
    expect(buildPluribusBroadcast([3])).toBe(
      "INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... USER 3, YOU HAVE COMPLETED THE STATIONING PROCESS",
    );
  });
  it("uses USERS (plural) and an Oxford-comma join for many", () => {
    expect(buildPluribusBroadcast([3, 7, 12])).toBe(
      "INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... USERS 3, 7, and 12, YOU HAVE COMPLETED THE STATIONING PROCESS",
    );
  });
});
