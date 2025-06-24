import { Uri } from "vscode";
import * as doc from "./api/document";
import {
	ElementId,
	WithId,
	WorkspaceState,
	WorkspaceFrontendEvents,
} from "./documentState";
import { EventEmitter } from "stream";
import { EventSubscriber, flattenArray } from "./utils";

export enum DocRelation {
	Title = "title",
	Link = "link",
	Text = "text",
}

export interface SymbolIdentifier {
	name: string;
	uri?: string;
}

export interface SymbolRelation {
	symbol: SymbolIdentifier;
	relation: DocRelation;
}

export interface SymbolDoc {
	relations: SymbolRelation[];
	element: ElementId;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SymbolManagerEvents = {
	docAdded: [doc: SymbolDoc];
	docRemoved: [doc: SymbolDoc];
}

// TODO: Properly index symbols by name/file.
export class SymbolManager extends EventEmitter<SymbolManagerEvents> {
	private docByElementId = new Map<ElementId, SymbolDoc>();
	private subscriber = new EventSubscriber<WorkspaceFrontendEvents>();

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

	dispose(): void {
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
			case "section": {
				const symbols = extractSymbolRelations(element);
				this.addDoc(element.elementId, symbols);
			} break;
		}
	}

	private onElementRemoved(element: WithId<doc.Element>) {
		this.removeDoc(element.elementId);
	}
}

function tryExtractUriSymbol(uri: Uri): SymbolIdentifier | undefined {
	if (
		uri.scheme &&
		!["file", "code", ""].find((scheme) => uri.scheme === scheme)
	) {
		return;
	}
	const filePath = uri.path;
	const symbol = uri.fragment;
	if (filePath.search(".") <= 0 || symbol.trim().length === 0) {
		return;
	}
	// TODO: Validate this is not a link to a non symbol :(
	return {
		name: symbol,
		uri: filePath,
	};
}

const FILE_SEP_PATTERN = /[^:]:[^:]/;

function tryExtractSymbol(
	text: string,
	clean = true
): SymbolIdentifier | undefined {
	if (clean) {
		text = text.trim();
	}

	// TODO: better symbol check, with seperate uri check on failure
	if (!isSymbolLike(text)) {
		return;
	}

	const uri = Uri.parse(text);
	const uriSymbol = tryExtractUriSymbol(uri);
	if (uriSymbol) {
		return uriSymbol;
	}

	// TODO: A better check for identifying <filename>:<symbol>
	const parts = text.split(FILE_SEP_PATTERN);

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
		case "link": {
			const symbol = tryExtractSymbol(element.destination);
			if (symbol) {
				relations.push({ relation: DocRelation.Link, symbol: symbol });
			}
		} break;
		case "text": {
			const innerSymbol = tryExtractSymbol(element.content);
			if (innerSymbol) {
				relations.push({
					relation: DocRelation.Text,
					symbol: innerSymbol,
				});
			}
		} break;
		case "section": {
			if (!traverseSection) {
				break;
			}
			const titleRels = flattenArray(
				element.children.map((subChild) =>
					_recursiveExtractSymbolRelations(subChild, false)
				)
			).map((rel) => ({
				relation: DocRelation.Title,
				symbol: rel.symbol,
			}));
			relations.push(...titleRels);
			relations.push(
				...flattenArray(
					element.blocks.map((subChild) =>
						_recursiveExtractSymbolRelations(subChild, false)
					)
				)
			);
		} break;
		case "block":
		case "bold":
		case "italics": {
			const childrenRel = element.children.map((subChild) =>
				_recursiveExtractSymbolRelations(subChild, false)
			);
			for (const childRel of childrenRel) {
				relations.push(...childRel);
			}
		} break;
	}
	return relations;
}

function isSymbolLike(text: string): boolean {
	// eslint-disable-next-line no-control-regex
	return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}
