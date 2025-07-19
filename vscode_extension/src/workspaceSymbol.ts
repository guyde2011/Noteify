import {
	commands,
	DocumentSymbol,
	Range,
	SymbolInformation,
	TextDocument,
	Uri,
	workspace,
} from "vscode";
import { SymbolIdentifier } from "./symbol";
import {
	fileParser,
	FileParser,
	findMinimalContainingNode,
	getNodeRange,
	ParsedFile,
	queriesCaptures,
	SourceFile,
} from "./treeSitter";
import { SyntaxNode } from "tree-sitter";
import { objectFromFields } from "./utils";
import { EventEmitter } from "node:events";

export type SymbolData = {
	name: string;
	range: Range;
	uri: Uri;
};

export type SymbolProviderEvents = {
	symbolAdded: [data: SymbolData];
	symbolRemoved: [data: SymbolData];
};

export interface SymbolProvider {
	extractSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined>;
	searchSymbol(query: SymbolQuery): Promise<SymbolData[]>;

	readonly events: EventEmitter<SymbolProviderEvents>;
}

export class LSPSymbolProvider implements SymbolProvider {
	public readonly events: EventEmitter<SymbolProviderEvents> =
		new EventEmitter();
	constructor() {}
	async extractSymbol(
		uri: Uri,
		range: Range
	): Promise<SymbolData | undefined> {
		const symbols = await commands.executeCommand<DocumentSymbol[]>(
			"vscode.executeDocumentSymbolProvider",
			uri
		);
		const symbol = symbols.find((symbol) =>
			symbol.selectionRange.contains(range)
		);
		return (
			symbol && {
				name: symbol.name,
				range: symbol.selectionRange,
				uri: uri,
			}
		);
	}

	async searchSymbol(query: SymbolIdentifier): Promise<SymbolData[]> {
		let output = [];
		const symbols = await commands.executeCommand<SymbolInformation[]>(
			"vscode.executeWorkspaceSymbolProvider",
			query.name
		);
		const queryFile = query.uri;
		const matchFile: (file: string) => boolean = queryFile
			? (file) => pathEndsWith(file, queryFile)
			: () => true;
		for (const symbol of symbols) {
			if (!matchFile(symbol.location.uri.fsPath)) {
				continue;
			}
			output.push({
				name: symbol.name,
				range: symbol.location.range,
				uri: symbol.location.uri,
			});
		}
		return output;
	}
}

type TSSymbol = {
	node: SyntaxNode;
	nameNode: SyntaxNode;
	queryable: boolean;
	children?: TSSymbol[];
	parent?: TSSymbol;
};

namespace TSSymbol {
	export function getName(symbol: TSSymbol): string {
		const nameParts = [];
		for (
			let curNode: TSSymbol | undefined = symbol;
			curNode;
			curNode = curNode.parent
		) {
			nameParts.push(curNode.nameNode.text);
		}
		return nameParts.reverse().join("::");
	}
}

class SymbolIndex {
	private symbolsByFile: Map<SourceFile, Map<string, TSSymbol[]>> = new Map();
	private symbolsByName: Map<string, Map<SourceFile, TSSymbol[]>> = new Map();
	private indexedRevision: Map<SourceFile, number> = new Map();

	addFile(parsedFile: ParsedFile, reindex: boolean = false): boolean {
		reindex =
			reindex ||
			this.indexedRevision.get(parsedFile.filePath) !==
				parsedFile.revision;
		if (!reindex && this.symbolsByFile.has(parsedFile.filePath)) {
			return false;
		}

		const flatSymbols = new Map<number, TSSymbol>();
		const scopeNodes = new Map<number, TSSymbol>();

		for (const query of parsedFile.api.symbolQueries.queries) {
			const matches = query.matches(parsedFile.tree.rootNode);
			for (const match of matches) {
				const namedCaptures = new Map(
					match.captures.map((capture) => [
						capture.name,
						capture.node,
					])
				);

				const root = namedCaptures.get("root");
				const name = namedCaptures.get("name");
				const scope = namedCaptures.get("scope");

				if (!root) {
					continue;
				}

				let nameNode: SyntaxNode;
				let queryable: boolean;
				if (name) {
					nameNode = name;
					queryable = true;
				} else if (scope) {
					nameNode = scope;
					queryable = false;
				} else {
					continue;
				}

				const symbol: TSSymbol = {
					node: root,
					nameNode: nameNode,
					queryable: queryable,
				};

				if (scope) {
					scopeNodes.set(root.id, symbol);
				}

				flatSymbols.set(nameNode.id, symbol);
			}
		}

		const childrenMap = new Map<number, TSSymbol[]>();
		const fileSymbols = new Map<string, TSSymbol[]>();

		for (const symbol of flatSymbols.values()) {
			// Try to find the node's parent symbol (scope, scoped identifier, etc.)
			for (
				let curNode = symbol.nameNode.parent;
				curNode && curNode !== parsedFile.tree.rootNode;
				curNode = curNode.parent
			) {
				const scopeNode = scopeNodes.get(curNode.id);
				// If this is a scope node and it isn't the current symbol we started at.
				if (scopeNode && scopeNode.nameNode.id !== symbol.nameNode.id) {
					let children = childrenMap.get(curNode.id);
					if (!children) {
						children = [];
						childrenMap.set(curNode.id, children);
					}
					children.push(symbol);
					break;
				}
			}

			const name = symbol.nameNode.text;
			let sharedName = fileSymbols.get(name);
			if (!sharedName) {
				sharedName = [];
				fileSymbols.set(name, sharedName);
			}
			sharedName.push(symbol);
		}

		for (const [parentId, children] of childrenMap) {
			const parent = scopeNodes.get(parentId)!;
			parent.children = children;
			children.forEach((child) => {
				child.parent = parent;
			});
		}

		this.addFileSymbols(parsedFile, fileSymbols);
		return true;
	}

	removeFile(file: SourceFile): boolean {
		if (!this.symbolsByFile.has(file)) {
			return false;
		}

		this.removeFileSymbols(file);

		return true;
	}

	getSymbols(
		name: string,
		exact: boolean = true,
		fileFilter: (file: SourceFile) => boolean = (_) => true,
		onlyQueryable: boolean = true
	): SymbolData[] {
		const seperatedName = name.split("::");
		const symbolName = seperatedName.pop()!;
		const baseSyms = this.symbolsByName.get(symbolName);
		if (!baseSyms) {
			return [];
		}

		type SearchResult = {
			file: SourceFile;
			symbol: TSSymbol;
			cursor?: TSSymbol;
		};

		let curSyms: SearchResult[] = [];
		for (const [file, fileSymbols] of baseSyms) {
			if (!fileFilter(file)) {
				continue;
			}
			curSyms.push(
				...fileSymbols.map((sym) => ({
					file: file,
					symbol: sym,
					cursor: sym,
				}))
			);
		}

		if (onlyQueryable) {
			curSyms = curSyms.filter((sym) => sym.symbol.queryable);
		}

		for (const curName of seperatedName.reverse()) {
			curSyms = curSyms
				.flatMap((sym) =>
					sym.cursor && sym.cursor.parent
						? [{ ...sym, cursor: sym.cursor.parent }]
						: []
				)
				.filter((sym) => sym.cursor.nameNode.text === curName);
		}

		if (exact) {
			curSyms = curSyms.filter((sym) => sym.cursor && !sym.cursor.parent);
		}

		const output = curSyms.map((symbol) => ({
			name: TSSymbol.getName(symbol.symbol),
			range: getNodeRange(symbol.symbol.node),
			uri: Uri.file(symbol.file),
		}));

		return output;
	}

	getFileSymbols(file: SourceFile): Map<string, TSSymbol[]> | undefined {
		return this.symbolsByFile.get(file);
	}

	private addFileSymbols(
		parsedFile: ParsedFile,
		fileSymbols: Map<string, TSSymbol[]>
	) {
		this.indexedRevision.set(parsedFile.filePath, parsedFile.revision);

		const file = parsedFile.filePath;

		if (this.symbolsByFile.has(file)) {
			this.removeFileSymbols(file);
		}
		this.symbolsByFile.set(file, fileSymbols);

		for (const [symbolName, symbols] of fileSymbols) {
			let symbolsWithName = this.symbolsByName.get(symbolName);
			if (!symbolsWithName) {
				symbolsWithName = new Map();
				this.symbolsByName.set(symbolName, symbolsWithName);
			}

			symbolsWithName.set(file, symbols);
		}
	}

	private removeFileSymbols(file: SourceFile) {
		const fileSymbols = this.symbolsByFile.get(file);
		if (!fileSymbols) {
			return;
		}
		this.symbolsByFile.delete(file);

		for (const symbolName in fileSymbols) {
			const symbolsWithName = this.symbolsByName.get(symbolName);
			if (!symbolsWithName) {
				// Weird but let's just continue
				console.warn(
					`Tried to delete a symbol ${symbolName} from the symbol index of file ${file}, but no symbol with such a name exists in the index`
				);
				continue;
			}

			symbolsWithName.delete(file);
		}
		this.indexedRevision.delete(file);
	}
}

/**
 * Used for providing symbol via tree-sitter.
 */
export class TSSymbolProvider implements SymbolProvider {
	public readonly events: EventEmitter<SymbolProviderEvents> =
		new EventEmitter();

	constructor(
		public readonly parser: FileParser,
		private symbolIndex: SymbolIndex
	) {}

	async extractSymbol(
		uri: Uri,
		range: Range
	): Promise<SymbolData | undefined> {
		const parsedFile = await this.parser.parseFile(uri.fsPath);
		if (!parsedFile) {
			return;
		}
		let scopes = [];
		const selectionNode = findMinimalContainingNode(range, parsedFile.tree);
		const nodeCaptures = queriesCaptures(
			parsedFile.api.symbolQueries.queries,
			selectionNode
		);

		let name;

		// TODO: avoid code duplication
		if (nodeCaptures.has("name") && nodeCaptures.get("name")!.length > 0) {
			name = nodeCaptures.get("name")![0].text;
		} else {
			name = selectionNode.text;
		}

		scopes.push(name);

		let node = selectionNode;
		while (node.parent) {
			const parentCaptures = queriesCaptures(
				parsedFile.api.symbolQueries.queries,
				node.parent,
				{ maxStartDepth: 0 } // Only query the current node
			);
			if (
				parentCaptures.has("scope") &&
				parentCaptures.get("scope")!.length > 0
			) {
				const scopeName = parentCaptures.get("scope")![0].text;
				scopes.push(scopeName);
			}
			node = node.parent;
		}
		return {
			name: scopes.reverse().join("::"),
			range: getNodeRange(selectionNode),
			uri: Uri.file(parsedFile.filePath),
		};
	}

	async searchSymbol(query: SymbolQuery): Promise<SymbolData[]> {
		const queryFile = query.file;
		const filenameFilter: (file: SourceFile) => boolean = queryFile
			? (file) => pathEndsWith(file, queryFile)
			: () => true;

		return this.symbolIndex.getSymbols(query.name, true, filenameFilter);
	}
}

export function pathEndsWith(path: string, suffix: string): boolean {
	// TODO: Real UNC canonicalization cause Windows is shit.
	const canonicalized = path.replace("\\", "/");
	if (!canonicalized.endsWith(suffix)) {
		return false;
	}

	if (canonicalized.length === suffix.length) {
		return true;
	}

	// This is to prevent finding the file ode.cpp when searching for code.cpp
	return (
		suffix.startsWith("/") ||
		canonicalized.charAt(canonicalized.length - suffix.length - 1) === "/"
	);
}

export type SymbolQuery = {
	name: string;
	file?: string;
};

// TODO: Make those per workspace.
export const lspProvider = new LSPSymbolProvider();

function createTSSymbolProvider() {
	const symbolIndex = new SymbolIndex();
	const provider = new TSSymbolProvider(fileParser, symbolIndex);

	function parseDocument(document: TextDocument) {
		const file: SourceFile = document.uri.fsPath;
		if (!fileParser.shouldParse(file)) {
			return;
		}

		const parsedFile = fileParser.parseFile(file, document.getText());
		if (!parsedFile) {
			return;
		}
		console.log("revision", parsedFile.revision);

		if (!symbolIndex.addFile(parsedFile)) {
			return;
		}

		const fileSymbols = symbolIndex.getFileSymbols(parsedFile.filePath);
		if (!fileSymbols) {
			return;
		}

		for (const symbols of fileSymbols.values()) {
			for (const symbol of symbols) {
				if (!symbol.queryable) {
					continue;
				}
				const data: SymbolData = {
					name: TSSymbol.getName(symbol),
					range: getNodeRange(symbol.nameNode),
					uri: document.uri,
				};
				provider.events.emit("symbolAdded", data);
			}
		}
	}

	// TODO: Dispose of those correctly, and implement them using an event listener interface or the like in the SymbolProvider
	workspace.onDidOpenTextDocument((document) => {
		parseDocument(document);
	});
	// TODO: Better implementation?
	workspace.onDidChangeTextDocument((document) =>
		parseDocument(document.document)
	);

	// // TODO: Maybe make this more deferred (like after 10 minutes of not looking on a file, unload it)
	// workspace.onDidCloseTextDocument((document) =>
	// 	symbolIndex.removeFile(document.uri.fsPath)
	// );

	for (const document of workspace.textDocuments) {
		parseDocument(document);
	}

	return provider;
}
export const tsProvider = createTSSymbolProvider();
