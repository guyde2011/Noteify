import { DocumentUpdateEvent, DocumentRemovedEvent } from "./events";

import * as doc from "./document";
import EventEmitter = require("events");

export interface DocumentProcessor {
	onDocumentUpdated(event: DocumentUpdateEvent): void;
	onDocumentRemoved(event: DocumentRemovedEvent): void;
}

export interface WorkspaceSessionEvents {
	sectionEditRequest: [
		sectionId: doc.SectionId,
		file: doc.File,
		content: doc.Section
	];
	sectionRevealRequest: [
		sectionId: doc.SectionId,
		file: doc.File
	]
}

export type Frontend = DocumentProcessor & {
	sessionEmitter: EventEmitter<WorkspaceSessionEvents>;
};
