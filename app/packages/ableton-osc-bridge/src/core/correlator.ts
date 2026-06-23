import type { OscArg } from "../transport";

export interface SubRecord {
  subId: string;
  startListenAddress: string;
  replyAddress: string;
  stopAddress: string;
  matchArgs: OscArg[];
  cb: (args: OscArg[]) => void;
}

interface Pending {
  address: string;
  matchArgs: OscArg[];
  resolve: (args: OscArg[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function prefixMatches(args: OscArg[], prefix: OscArg[]): boolean {
  return prefix.every((v, i) => args[i] === v);
}

/** Routes incoming OSC messages to waiting queries and active subscriptions. Pure (no IO). */
export class Correlator {
  private pending: Pending[] = [];
  private subs = new Map<string, SubRecord>();

  registerQuery(address: string, matchArgs: OscArg[], timeoutMs: number): Promise<OscArg[]> {
    return new Promise<OscArg[]>((resolve, reject) => {
      const entry: Pending = {
        address,
        matchArgs,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = this.pending.filter((p) => p !== entry);
          reject(new Error(`query timeout: ${address}`));
        }, timeoutMs),
      };
      this.pending.push(entry);
    });
  }

  addSubscription(rec: SubRecord): void {
    this.subs.set(rec.subId, rec);
  }

  removeSubscription(subId: string): void {
    this.subs.delete(subId);
  }

  activeSubscriptions(): SubRecord[] {
    return [...this.subs.values()];
  }

  handleIncoming(address: string, args: OscArg[]): void {
    const idx = this.pending.findIndex((p) => p.address === address && prefixMatches(args, p.matchArgs));
    if (idx >= 0) {
      const [p] = this.pending.splice(idx, 1);
      clearTimeout(p.timer);
      p.resolve(args);
    }
    for (const s of this.subs.values()) {
      if (s.replyAddress === address && prefixMatches(args, s.matchArgs)) s.cb(args);
    }
  }

  rejectAll(err: Error): void {
    for (const p of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending = [];
  }
}
