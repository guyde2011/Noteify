import * as vscode from "vscode";
import * as net from "node:net";
import { env as environ } from "node:process";
import { join as pathJoin } from "node:path";
import { stat as fsStat } from "node:fs/promises";
import {
    Backend,
    BackendFeatures,
    BackendInstance,
    BackendResult,
    BackendStatus,
} from "./interface";
import * as Doc from "./document";
import { BackendEvent } from "./events";
import JsonSocket from "../util/JsonSocket";
import { fstat } from "node:fs";
import { list } from "mdast-util-to-markdown/lib/handle/list";

function getServerSocketPath(): string {
    if ("XDG_RUNTIME_DIR" in environ) {
        return pathJoin(environ["XDG_RUNTIME_DIR"]!, "obsidian-rpc.sock");
    }
    throw Error("No XDG_RUNTIME_DIR environment variable");
}

export type ObsidianRevealMessage = {
    op: "reveal";
    docId: number;
};

export class ObsidianBackend implements Backend {
    initialized: boolean = false;
    name: string = "Obsidian";
    socketPath: string | null = null;

    async init(): Promise<void> {
        // Checks whether the obsidian-rpc socket file exists on the filesystem.
        // This is a good usage of init() in a backend. It can tell us whether Obsidian is relevant on this system.
        try {
            this.socketPath = getServerSocketPath();
            const stat = await fsStat(this.socketPath);
            if (stat.isSocket()) {
                this.initialized = true;
            }
        } catch (e) {}
    }

    async open(listener: (inst: BackendInstance, ev: BackendEvent) => void): Promise<BackendStatus> {
        return new Promise((resolve) => {
            let instance: ObsidianInstance | undefined = undefined;

            const socket = net.createConnection({ path: this.socketPath! }, () => {
                // on connection: open succeeded!
                // this should happen before any packet data arrives to the instance, so that open is the first event.
                listener(instance!, { op: "open" });;
                resolve(BackendStatus.Success);
            }).on("error", (err: Error) => {
                // failed connection
                console.error(`Obsidian connection failed due to ${err.toString()}`);
                resolve(BackendStatus.ConnectionClosed);
            });

            // should get garbage collected if the socket failed and isn't referenced by the networking system due to its waiting
            instance = new ObsidianInstance(socket, listener);
        });
    }
}

export class ObsidianInstance extends JsonSocket implements BackendInstance {
    // mandatory for backend workspaces
    readonly features: BackendFeatures = {
        revealSection: async (sectionId) => {
            // TODO wait for some kind of response from Obsidian RPC.
            // TODO add a success/failure ack message to Obsidian RPC
            if (this.connectionClosed) {
                return BackendStatus.ConnectionClosed;
            }

            const msg: ObsidianRevealMessage = { op: "reveal", docId: sectionId };
            this.sendJson(msg);
            return BackendStatus.Success;
        },
    };

    properties = {
        viaName: "Noteify via Obsidian",
    };

    // Implementation of ObsidianInstance
    /**
     * Set once the underlying socket has fired its 'end' event.
     */
    connectionClosed: boolean = false;

    onSocketEnd(): void {
        // We are now in ConnectionClosed status
        this.connectionClosed = true;
    }

    onJson(o: object): void {
        console.log("Got JSON from Obsidian:", o);
        if (!("op" in o)) {
            console.log("Unexpected JSON object without an op field:", o);
            return;
        }
        switch (o.op) {
            case "send": case "remove": {
                this.listener(this, (o as unknown) as BackendEvent);
            } break;

            default: {
                console.log("Unexpected JSON message type:", o.op);
            } break;
        }
    }

    constructor(socket: net.Socket, public listener: (inst: BackendInstance, ev: BackendEvent) => void) {
        super(socket);
    }

    dispose(): void {
        // does nothing
    }
}