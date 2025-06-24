import * as Doc from "./document";
import { BackendStatus } from "./interface";

export interface BackendOpenEvent {
    op: "open";
}

export interface BackendClosedEvent {
    op: "close";
    status: BackendStatus;
}

export interface DocumentUpdateEvent {
    op: "send";
    doc: Doc.Root;
}

export interface DocumentRemovedEvent {
    op: "remove";
    filename: string;
}

export type BackendEvent = BackendOpenEvent | BackendClosedEvent | DocumentUpdateEvent | DocumentRemovedEvent;