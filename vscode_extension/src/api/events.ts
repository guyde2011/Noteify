import * as Doc from "./document";
import { BackendStatus } from "./interface";

export type BackendOpenEvent = {
    op: "open";
};

export type BackendClosedEvent = {
    op: "close";
    status: BackendStatus;
};

export type DocumentUpdateEvent = {
    op: "send";
    doc: Doc.Root;
};

export type DocumentRemovedEvent = {
    op: "remove";
    filename: string;
};

export type BackendEvent = BackendOpenEvent | BackendClosedEvent | DocumentUpdateEvent | DocumentRemovedEvent;