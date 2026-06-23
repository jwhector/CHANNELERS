/** The only OSC argument type carried on the wire. */
export type OscArg = string | number;

/** Handle returned by subscribe(); call to stop receiving and tear down the listen. */
export interface Subscription {
  unsubscribe(): void;
}

/**
 * The three verbs every transport implements. The typed facade (Plan B) depends
 * ONLY on this, so the same calls work over the local core and the network client.
 *  - send: fire-and-forget (no reply)
 *  - query: request → one reply, correlated back as a Promise
 *  - subscribe: start_listen → a stream of replies via cb
 */
export interface VerbProvider {
  send(address: string, args?: OscArg[]): void;
  query(address: string, args?: OscArg[], timeoutMs?: number): Promise<OscArg[]>;
  subscribe(
    startListenAddress: string,
    args: OscArg[],
    cb: (args: OscArg[]) => void,
  ): Subscription;
}
