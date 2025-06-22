import {
	commands,
	DocumentSymbol,
	Range,
	SymbolInformation,
	Uri,
} from "vscode";
import { SymbolIdentifier } from "./symbol";

export type SymbolData = {
	name: string;
	range: Range;
	uri: Uri;
};

export interface SymbolProvider {
	extractSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined>;
	searchSymbol(query: SymbolQuery): Promise<SymbolData[]>;
}

export class LSPSymbolProvider implements SymbolProvider {
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
			? (file) => file.replace("\\", "/").endsWith(queryFile)
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

export type SymbolQuery = {
	name: string;
	file?: string;
};

export const lspProvider = new LSPSymbolProvider();
