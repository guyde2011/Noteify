import {
	DocumentUpdateEvent,
	DocumentRemovedEvent,
} from "./events";

export interface DocumentProcessor {
	onDocumentUpdated(event: DocumentUpdateEvent): void;
	onDocumentRemoved(event: DocumentRemovedEvent): void;
}
