import { commands, DocumentSymbol, Range, SymbolInformation, Uri, workspace } from "vscode";
import { FileParser, fileParser, findMinimalContainingNode, getNodeRange, queriesCaptures } from "./parsing";


export type SymbolData = {
    name: string
    range: Range
    uri: Uri
};

export interface SymbolProvider {
    extractSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined>;
    searchSymbol(query: SymbolQuery): Promise<SymbolData[]>;
}

export class TSSymbolProvider implements SymbolProvider {
    constructor(public readonly parser: FileParser) { }

    async extractSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined> {
        const parsedFile = await this.parser.parseFile(uri.fsPath);
        if (!parsedFile) {
            return;
        }
        let scopes = [];
        const selectionNode = findMinimalContainingNode(range, parsedFile.tree);
        const nodeCaptures = queriesCaptures(parsedFile.api.symbolQueries.queries, selectionNode);

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
                { maxStartDepth: 0 }  // Only query the current node
            );
            if (parentCaptures.has("scope") && parentCaptures.get("scope")!.length > 0) {
                const scopeName = parentCaptures.get("scope")![0].text;
                scopes.push(scopeName);
            }
            node = node.parent;
        }
        return {
            name: scopes.reverse().join("::"),
            range: getNodeRange(selectionNode),
            uri: Uri.file(parsedFile.filePath)
        };

    }

    async searchSymbol(query: SymbolQuery): Promise<SymbolData[]> {
        let output = [];
        // TODO: Use a query for supported tree sitter languages (maybe with additional user config) instead of **
        const fileQuery = query.file ? query.file : "**";
        const files = await workspace.findFiles(fileQuery);

        const scopeNames = query.name.split("::");
        const name = scopeNames[scopeNames.length - 1];
        for (const file of files) {
            const parsedFile = await fileParser.parseFile(file.fsPath);
            if (!parsedFile) {
                continue;
            }

            // We should probably do this somehow without creating the queries for each file
            const nameQueries = parsedFile.api.symbolQueries.checkCaptures({ name: name });
            const captures = queriesCaptures(nameQueries, parsedFile.tree.rootNode);
            if (!(captures.has("name"))) {
                continue;
            }
            for (const capture of captures.get("name")!) {
                const symbol = await this.extractSymbol(file, getNodeRange(capture));
                if (symbol && symbol.name.endsWith(query.name)) {
                    output.push(symbol);
                }
            }
        }
        return output;
    }

}

export class LSPSymbolProvider implements SymbolProvider {
    constructor() { }
    async extractSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined> {
        const symbols = await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", uri);
        const symbol = symbols.find((symbol) => symbol.selectionRange.contains(range));
        return symbol && {
            name: symbol.name,
            range: symbol.selectionRange,
            uri: uri
        };
    }

    async searchSymbol(query: SymbolQuery): Promise<SymbolData[]> {
        let output = [];
        const symbols = await commands.executeCommand<SymbolInformation[]>(
            "vscode.executeWorkspaceSymbolProvider",
            query.name
        );
        const queryFile = query.file;
        const matchFile: (file: string) => boolean = (queryFile ?
            (file) => file.replace("\\", "/").endsWith(queryFile) :
            () => true
        );
        for (const symbol of symbols) {
            if (!matchFile(symbol.location.uri.fsPath)) {
                continue;
            }
            output.push({
                name: symbol.name,
                range: symbol.location.range,
                uri: symbol.location.uri
            });
        }
        return output;
    }

}

export type SymbolQuery = {
    name: string
    file?: string
};

export const lspProvider = new LSPSymbolProvider();
export const tsProvider = new TSSymbolProvider(fileParser);