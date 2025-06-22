import { Uri } from "vscode";

export type Symbol = string;

var linkedDocId = 0;

export abstract class LinkedDoc {
    public readonly innerId: number;
    constructor() {
        this.innerId = linkedDocId++;
    }
}

// export var symbolDocManager = new SymbolDocManager(docManager);

function isSymbolLike(text: string): boolean {
    return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}

/**
 * Should extract a symbol from a symbol declaration string.
 * So for example:
 * ```cpp
 * void foo::bar() {}
 * ```
 * should return `foo::bar`
 */
export function extractIDESymbolName(symbolName: string): string {
    // TODO: proper implementation!
    return symbolName.split("(")[0].split("<")[0].replace(";", "");
}