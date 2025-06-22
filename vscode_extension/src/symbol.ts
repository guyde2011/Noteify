import { Uri } from "vscode";
import * as doc from "./api/document";
import {
	ElementId,
	WithId,
	WorkspaceState,
	WorkspaceStateEvents,
} from "./documentState";
import { EventEmitter } from "stream";
import { EventSubscriber } from "./utils";

export enum DocRelation {
	Title = "title",
	Link = "link",
}

export type SymbolIdentifier = {
	name: string;
	uri?: string;
};

export type SymbolRelation = {
	symbol: SymbolIdentifier;
	relation: DocRelation;
};

export type SymbolDoc = {
	relations: SymbolRelation[];
	element: ElementId;
};

export type SymbolManagerEvents = {
	docAdded: [doc: SymbolDoc];
	docRemoved: [doc: SymbolDoc];
};

// TODO: Properly index symbols by name/file.
export class SymbolManager extends EventEmitter<SymbolManagerEvents> {
	private docByElementId: Map<ElementId, SymbolDoc> = new Map();
	private subscriber: EventSubscriber<WorkspaceStateEvents> =
		new EventSubscriber();

	constructor(public readonly state: WorkspaceState) {
		super();
		this.subscriber
			.subscribe(state, "elementAdded", this.onElementAdded.bind(this))
			.subscribe(
				state,
				"elementRemoved",
				this.onElementRemoved.bind(this)
			);
	}

	dispose() {
		this.subscriber.dispose();
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
		this.docByElementId.set(elementId, symbolDoc);

		this.emit("docAdded", symbolDoc);

		return existing;
	}

	removeDoc(elementId: ElementId): SymbolDoc | undefined {
		const symbolDoc = this.docByElementId.get(elementId);
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
		}
	}

	private onElementRemoved(element: WithId<doc.Element>) {
		this.removeDoc(element.elementId);
	}
}

function tryExtractUriSymbol(uri: Uri): SymbolIdentifier | undefined {
	if (
		uri.scheme &&
		!["", "file", "code"].find((scheme) => uri.scheme === scheme)
	) {
		return;
	}
	const filePath = uri.path;
	const symbol = uri.fragment;
	// TODO: Validate this is not a link to a non symbol :(
	return {
		name: symbol,
		uri: filePath,
	};
}

function tryExtractSymbol(
	text: string,
	clean: boolean = true
): SymbolIdentifier | undefined {
	if (clean) {
		text = text.trim();
	}

	// TODO: better symbol check, with seperate uri check on failure
	if (!isSymbolLike(text)) {
		return;
	}

	const uri = Uri.parse(text);
	if (uri) {
		return tryExtractUriSymbol(uri);
	}

	// TODO: A better check for identifying <filename>:<symbol>
	const parts = text.split(/[^:]:[^:]/);
	if (parts.length === 1) {
		return {
			name: parts[0],
		};
	} else if (parts.length === 2) {
		const [path, name] = parts;
		return {
			name: name,
			uri: path,
		};
	}
}

function extractSymbolRelations(element: doc.Element): SymbolRelation[] {
	return _recursiveExtractSymbolRelations(element, true);
}

function _recursiveExtractSymbolRelations(
	element: doc.Element,
	traverseSection: boolean
): SymbolRelation[] {
	const relations: SymbolRelation[] = [];
	// Iterate over title parts
	switch (element.kind) {
		case "link":
			const symbol = tryExtractSymbol(element.destination);
			if (symbol) {
				relations.push({ relation: DocRelation.Link, symbol: symbol });
			}
			break;
		case "text":
			break;
		case "section":
			if (!traverseSection) {
				break;
			}
		case "block":
		case "bold":
		case "italics":
			const childrenRel = element.children.map((subChild) =>
				_recursiveExtractSymbolRelations(subChild, false)
			);
			for (const childRel of childrenRel) {
				relations.concat(childRel);
			}
			break;
	}
	return relations;
}

function isSymbolLike(text: string): boolean {
	return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}

