import {
	DocumentAddedEvent,
	DocumentRemovedEvent,
	SectionAddedEvent,
	SectionChangedEvent,
	SectionRemovedEvent,
} from "./events";

export interface DocumentProcessor {
	onSectionAdded(event: SectionAddedEvent): Promise<void>;
	onSectionChanged(event: SectionChangedEvent): Promise<void>;
	onSectionRemoved(event: SectionRemovedEvent): Promise<void>;

	onDocumentAdded(event: DocumentAddedEvent): Promise<void>;
	onDocumentRemoved(event: DocumentRemovedEvent): Promise<void>;
}
