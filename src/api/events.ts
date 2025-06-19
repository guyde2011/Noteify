import * as Doc from "./document";
import { BackendInstance } from "./interface";

export type OpenEvent = {
    op: "open";
    instance: BackendInstance;
};

export type AddOrChangeEvent = {
    op: "send";
    doc: Doc.Root;
};

export type RemoveEvent = {
    op: "remove";
    filename: string;
};

export type UpdateEvent = AddOrChangeEvent | RemoveEvent;

/*
export type SectionAddedEvent = {
    id: doc.SectionId
    file: doc.DocumentId
    contents: doc.Section
};

export type SectionChangedEvent = {
    id: doc.SectionId
    file: doc.DocumentId
    oldContents: doc.Section
    newContents: doc.Section
};

export type SectionRemovedEvent = {
    id: doc.SectionId
    file: doc.DocumentId
    contents: doc.Section
};

export type DocumentRemovedEvent = {
    file: doc.DocumentId
    uri: string
};

export type DocumentAddedEvent = {
    file: doc.DocumentId
    uri: string
};
*/