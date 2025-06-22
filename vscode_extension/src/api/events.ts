/**
 * This file defines the Session-Backend interface. Other messages may exist within backends, but they are not processed by the Session.
 */

import * as Doc from "./document";
import { BackendInstance, BackendStatus } from "./interface";

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