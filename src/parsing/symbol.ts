import { Tree } from "tree-sitter";
import { commands, DocumentSymbol, Range, SymbolInformation, Uri, workspace } from "vscode";
import { fileParser, findMinimalContainingNode, getNodeRange, ParsedFile, queriesCaptures } from "./parsing";
import { } from "path";


export type SymbolData = {
    name: string
    range: Range
    uri: Uri
};


export function extractTSSymbol(parsedFile: ParsedFile, symbolRange: Range): SymbolData | undefined {
    // TODO: maybe run this on the whole file and save the results instead of on-demand
    let scopes = [];
    const selectionNode = findMinimalContainingNode(symbolRange, parsedFile.tree);
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

export async function extractLSPSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined> {
    const symbols = await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", uri);
    for (const symbol of symbols) {
        if (symbol.selectionRange.contains(range)) {
            return {
                name: symbol.name,
                range: symbol.selectionRange,
                uri: uri
            };
        }
    }
}

export type SymbolQuery = {
    name: string
    file?: string
};

export async function searchLSPSymbol(symbolQuery: SymbolQuery): Promise<SymbolData[]> {
    let output = [];
    const symbols = await commands.executeCommand<SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        symbolQuery.name
    );
    const queryFile = symbolQuery.file;
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

export async function searchTSSymbol(symbolQuery: SymbolQuery): Promise<SymbolData[]> {
    let output = [];
    // TODO: Use a query for supported tree sitter languages (maybe with additional user config) instead of **
    const fileQuery = symbolQuery.file ? symbolQuery.file : "**";
    const files = await workspace.findFiles(fileQuery);

    const scopeNames = symbolQuery.name.split("::");
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
            const symbol = extractTSSymbol(parsedFile, getNodeRange(capture));
            if (symbol && symbol.name.endsWith(symbolQuery.name)) {
                output.push(symbol);
            }
        }
    }
    return output;
}