import {
	AddOrChangeEvent,
	RemoveEvent,
} from "./events";

export interface DocumentProcessor {
	onDocumentAddedOrChanged(event: AddOrChangeEvent): Promise<void>;
	onDocumentRemoved(event: RemoveEvent): Promise<void>;
}
