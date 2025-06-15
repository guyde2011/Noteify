import { Uri } from "vscode";
import { docManager, DocsManager as DocManager, DocSection, MarkdownSection } from "./markdown";

export type Symbol = string;

var symbolDocId = 0;

export class SymbolDoc {
    public readonly innerId: number;
    constructor(
        public symbol: Symbol,
        public docs: DocSection,
        public uri: Uri,
    ) {
        this.innerId = symbolDocId++;
    }
};


export class SymbolDocManager {
    // TODO: Maybe make the element type a map index by innerId for faster dedup
    private symbolDocs: Map<Symbol, SymbolDoc[]>;

    constructor(public readonly docManager: DocManager) {
        this.symbolDocs = new Map<Symbol, SymbolDoc[]>();
    }

    private processDocs(sections: DocSection[], docUri: Uri): SymbolDoc[] {
        // TODO: prevent duplication processing of symbol docs
        let output = [];
        for (const symbolDoc of extractSymbolDocs(sections, docUri)) {
            if (!this.symbolDocs.has(symbolDoc.symbol)) {
                this.symbolDocs.set(symbolDoc.symbol, []);
            }
            console.log(symbolDoc);
            let newDoc = true;
            for (const doc of this.symbolDocs.get(symbolDoc.symbol)!) {
                if (doc.innerId === symbolDoc.innerId) {
                    // Workaround
                    newDoc = false;
                    break;
                }
                if (doc.uri === docUri && doc.docs.sectionIndex === symbolDoc.docs.sectionIndex) {
                    doc.docs = symbolDoc.docs;
                    newDoc = false;
                    break;
                }
            }

            if (newDoc) {
                output.push(symbolDoc);
                this.symbolDocs.get(symbolDoc.symbol)!.push(symbolDoc);
            }
        }
        return output;
    }

    getSymbolDocs(symbol: Symbol): SymbolDoc[] {
        if (this.symbolDocs.has(symbol)) {
            return this.symbolDocs.get(symbol)!;
        }
        return [];
    }


    getAllSymbols(): Symbol[] {
        return Array.from(this.symbolDocs.keys());
    }


    updateDocs(uri: Uri): SymbolDoc[] {
        // TODO: FFS stop updating every comment for every change!
        const sections = this.docManager.getSections(uri);
        if (!sections) {
            return [];
        }
        return this.processDocs(sections, uri);
    }

    createSymbolDoc(symbol: Symbol, docUri: Uri): SymbolDoc {
        // TODO: figure the right hashCount
        const emptySection = new MarkdownSection(symbol, 3, []);
        this.docManager.appendSection(docUri, emptySection);
        const updatedDocs = this.updateDocs(docUri);
        return updatedDocs[updatedDocs.length - 1];
    }

}

export var symbolDocManager = new SymbolDocManager(docManager);

function isSymbolLike(text: string): boolean {
    return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}

export function extractSymbolDocs(sections: DocSection[], uri: Uri): SymbolDoc[] {
    return sections.filter((section) => isSymbolLike(section.section.title)).map((section) => {
        return new SymbolDoc(
            section.section.title.trim(),
            section,
            uri,
        );
    });
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