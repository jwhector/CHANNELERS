// node-osc ships no type declarations; this covers the surface we use.
declare module "node-osc" {
  export class Client {
    constructor(host: string, port: number);
    send(...args: Array<string | number | ((err?: Error) => void)>): void;
    close(): void;
  }
  export class Server {
    constructor(port: number, host?: string, cb?: () => void);
    on(event: "message", listener: (msg: [string, ...Array<string | number>], rinfo: unknown) => void): this;
    close(cb?: () => void): void;
  }
}
