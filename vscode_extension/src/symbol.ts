import * as doc from "./api/document";
import { ElementId, WithId, WorkspaceState } from "./documentState";
import { EventEmitter } from "stream";

type Symbol = string;

enum DocRelation {
	Title = "title",
	Link = "link",
}

type SymbolIdentifier = {
	name: string;
	uri?: string;
};

type SymbolRelation = {
	symbol: SymbolIdentifier;
	relation: DocRelation;
};

export type SymbolDoc = {
	relations: SymbolRelation[];
	element: ElementId;
};

type SymbolManagerEvents = {
	docAdded: [doc: SymbolDoc];
	docRemoved: [doc: SymbolDoc];
};

export class SymbolManager extends EventEmitter<SymbolManagerEvents> {
	private symbolDocs: Map<ElementId, SymbolDoc> = new Map();

	constructor(private state: WorkspaceState) {
		super();
		state.on("elementAdded", this.onElementAdded);
		state.on("elementRemoved", this.onElementRemoved);
	}

	dispose() {
		this.state.removeListener("elementAdded", this.onElementAdded);
		this.state.removeListener("elementRemoved", this.onElementRemoved);
	}

	addDoc(
		elementId: ElementId,
		relations: SymbolRelation[]
	): SymbolDoc | undefined {
		// Remove the document if it already exists
		const existing = this.removeDoc(elementId);

		const symbolDoc: SymbolDoc = {
			element: elementId,
			relations: relations,
		};
		this.symbolDocs.set(elementId, symbolDoc);

		this.emit("docAdded", symbolDoc);

		return existing;
	}

	removeDoc(elementId: ElementId): SymbolDoc | undefined {
		const symbolDoc = this.symbolDocs.get(elementId);
		if (!symbolDoc) {
			return;
		}
		this.emit("docRemoved", symbolDoc);
		return symbolDoc;
	}

	private onElementAdded(element: WithId<doc.Element>) {
		switch (element.kind) {
			case "section":
				const symbols = extractSymbolRelations(element);
				this.addDoc(element.elementId, symbols);
				break;
			case "link":
				// TODO: Implement
				break;
		}
	}

	private onElementRemoved(element: WithId<doc.Element>) {
		this.removeDoc(element.elementId);
	}
}

function extractSymbolRelations(element: doc.Section): SymbolRelation[] {
	// TODO: Extract from links and such.
	// Iterate over title parts
	for (const child of element.children) {
		switch (child.kind) {
			case "link":

				break;
			case "text":
				const cleanContent = child.content.trim();
				if (isSymbolLike())
		}
	}
}

/*
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
*/

/*
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
*/
/*
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
				*/
/*
			}
		}
		return output;
	}
}

class SymbolCommentProcessor extends SymbolProcessor {}
*/

/*
function isSymbolLike(text: string): boolean {
	return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}
*/
