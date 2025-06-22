import { env as environ } from "node:process";
import { join as pathJoin } from "node:path";

export function getServerSocketPath(): string {
    if ("XDG_RUNTIME_DIR" in environ) {
        return pathJoin(environ["XDG_RUNTIME_DIR"]!, "obsidian-rpc.sock");
    }
    throw Error("No XDG_RUNTIME_DIR environment variable");
}
