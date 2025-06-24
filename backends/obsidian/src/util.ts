import { env as environ } from "node:process";
import { join as pathJoin } from "node:path";

export function getServerSocketPath(): string {
    const xdgRuntimeDir = environ["XDG_RUNTIME_DIR"];
    if (xdgRuntimeDir !== undefined) {
        return pathJoin(xdgRuntimeDir, "obsidian-rpc.sock");
    }
    throw Error("No XDG_RUNTIME_DIR environment variable");
}
