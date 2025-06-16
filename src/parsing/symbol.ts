import { Tree } from "tree-sitter";
import { commands, DocumentSymbol, Range, Uri } from "vscode";
import { findMinimalContainingNode, getNodeRange, ParsedFile, queriesCaptures } from "./parsing";


export type SymbolData = {
    name: string
    range: Range
};


export function extractTSSymbol(parsedFile: ParsedFile, symbolRange: Range): SymbolData | undefined {
    // TODO: maybe run this on the whole file and save the results instead of on-demand
    let scopes = [];
    const selectionNode = findMinimalContainingNode(symbolRange, parsedFile.tree);
    const nodeCaptures = queriesCaptures(parsedFile.api.symbolQueries, selectionNode);

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
        const parentCaptures = queriesCaptures(parsedFile.api.symbolQueries, node.parent, { maxStartDepth: 0 });
        if (parentCaptures.has("scope") && parentCaptures.get("scope")!.length > 0) {
            const scopeName = parentCaptures.get("scope")![0].text;
            scopes.push(scopeName);
        }
        node = node.parent;
    }
    return {
        name: scopes.reverse().join("::"),
        range: getNodeRange(selectionNode)
    };
}

export async function extractLSPSymbol(uri: Uri, range: Range): Promise<SymbolData | undefined> {
    const symbols = await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", uri);
    for (const symbol of symbols) {
        if (symbol.selectionRange.contains(range)) {
            return {
                name: symbol.name,
                range: symbol.selectionRange
            };
        }
    }
}