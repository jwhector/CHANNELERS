// node-osc ships no type declarations; this covers the small surface we use.
declare module "node-osc" {
  export class Client {
    constructor(host: string, port: number);
    send(...args: Array<string | number | ((err?: Error) => void)>): void;
    close(): void;
  }
}
