import * as doc from "./document";

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