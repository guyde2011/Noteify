import { Uri } from "vscode";
import { Section, SectionId } from "./api/document";
import {
	SectionAddedEvent,
	SectionChangedEvent,
	SectionRemovedEvent,
	DocumentAddedEvent,
	DocumentRemovedEvent,
} from "./api/events";
import { DocumentProcessor } from "./api/frontend";
import { writeError } from "./utils";

type Symbol = string;

enum DocRelation {
	Title = "title",
	Link = "link",
}

type SymbolIdentifier = {
	name: string;
	uri?: string;
};

type SymbolDoc = {
	symbol: SymbolIdentifier;
	relation: DocRelation;
};

function parseSymbol(rawSymbol: string): SymbolIdentifier | undefined {
	try {
		const uri = Uri.parse(rawSymbol);
		if (
			uri.scheme === "" ||
			(uri.scheme === "file" && isSymbolLike(uri.fragment))
		) {
			return { name: uri.fragment, uri: uri.fsPath };
		}
	} catch {
		if (isSymbolLike(rawSymbol)) {
			return { name: rawSymbol };
		}
	}
}

class SymbolProcessor implements DocumentProcessor {
	private symbolDocs: Map<SectionId, SymbolDoc[]> = new Map();

	private extractSymbols(section: Section): SymbolDoc[] {
		const output = [];
		if (isSymbolLike(cleanTitle)) {
			const symbol = parseSymbol(cleanTitle);
			if (symbol) {
				output.push({
					symbol: symbol,
					relation: DocRelation.Title,
				});
			}
		}
		for (const child of section.children) {
			switch (child.kind) {
				case "link": {
					const symbol = parseSymbol(child.uri);
					if (symbol) {
						output.push({
							symbol: symbol,
							relation: DocRelation.Link,
						});
					}
                    break;
				}
				case "title": {
					const symbol = parseSymbol(child.content);
					if (symbol) {
						output.push({
							symbol: symbol,
							relation: DocRelation.Title,
						});
					}
				}
			}
		}
		return output;
	}

	async onSectionAdded(event: SectionAddedEvent) {
		const symbolDocs = this.extractSymbols(event.contents);
		if (this.symbolDocs.has(event.id)) {
			writeError(
				`onSectionAdded: Section with id ${event.id} already exists`
			);
			return;
		}

		this.symbolDocs.set(event.id, symbolDocs);
	}
	async onSectionChanged(event: SectionChangedEvent) {
		const symbolDocs = this.extractSymbols(event.newContents);
		if (!this.symbolDocs.has(event.id)) {
			writeError(
				`onSectionChanged: Section with id ${event.id} doesn't exists`
			);
			return;
		}

		this.symbolDocs.set(event.id, symbolDocs);
	}

	async onSectionRemoved(event: SectionRemovedEvent) {
		if (!this.symbolDocs.has(event.id)) {
			writeError(
				`onSectionRemoved: Section with id ${event.id} doesn't exists`
			);
			return;
		}

		const curDocs = this.symbolDocs.get(event.id)!;

		this.symbolDocs.delete(event.id);
	}

	async onDocumentAdded(event: DocumentAddedEvent): Promise<void> {}

	async onDocumentRemoved(event: DocumentRemovedEvent): Promise<void> {}
}

class SymbolCommentProcessor extends SymbolProcessor {}

function isSymbolLike(text: string): boolean {
	return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}
