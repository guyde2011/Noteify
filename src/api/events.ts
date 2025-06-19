import * as Doc from "./document";
import { BackendInstance } from "./interface";

export type BackendOpenEvent = {
    op: "open";
};

export type DocumentUpdateEvent = {
    op: "send";
    doc: Doc.Root;
};

export type DocumentRemovedEvent = {
    op: "remove";
    filename: string;
};

export type BackendEvent = BackendOpenEvent | DocumentUpdateEvent | DocumentRemovedEvent;