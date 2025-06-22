import * as net from "node:net";
import * as Doc from "./document";
import { State } from "./State";
import JsonSocket from "./JsonSocket";

export type SendMessage = {
    op: "send";
    doc: Doc.Root;
};

export type RemoveMessage = {
    op: "remove";
    filename: string;
};

export type UpdateMessage = SendMessage | RemoveMessage;

export type RevealMessage = {
    op: "reveal";
    docId: number;
};

export type RequestMessage = RevealMessage;

export default class Client extends JsonSocket {
    private constructor(public appState: State, socket: net.Socket) {
        super(socket);
    }

    static newConnection(appState: State, socket: net.Socket): void {
        const result = new Client(appState, socket);
        appState.addClient(result);
    }

    onSocketEnd() {
        console.log("Socket end");
        this.appState.removeClient(this);
    }

    onJson(o: object) {
        console.log("Got a JSON object from a client:", o);
        if (!("op" in o)) {
            console.log("Unexpected JSON object without an op field:", o);
            return;
        }
        switch (o.op) {
            case "reveal": {
                const msg = o as RevealMessage;
                this.appState.onRevealMessage(msg);
            } break;

            default: {
                console.log("Unexpected JSON message type in RPC:", o.op);
            } break;
        }
    }

    sendDocument(doc: Doc.Root): void {
        this.sendJson({ op: "send", doc } as SendMessage);
    }

    removeDocument(filename: string): void {
        this.sendJson({ op: "remove", filename } as RemoveMessage);
    }
}