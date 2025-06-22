import { TAbstractFile, TFile, Vault } from "obsidian";
import { IdAllocator, parseDocument, SectionIdInfo } from "./markdown";
import * as Doc from "./document";
import Client, { RevealMessage } from "./Client";

function isMarkdownFile(maybeFile: TAbstractFile): TFile | null {
    if (!(maybeFile instanceof TFile) || maybeFile.extension != "md") {
        return null;
    }
    return maybeFile;
}

export interface FrontendInterface {
    goTo(file: string, line: number, column: number): void;
}

export class State {
    documentByPath: Map<string, [Doc.Root, Doc.SectionId[]]> = new Map();
    globalSectionIdMap: Map<Doc.SectionId, SectionIdInfo> = new Map();
    listeningClients: Client[] = [];
    /**
     * all section objects are given unique incrementing IDs.
     * Even if the contents stayed the same, every update to a file leads to entirely new IDs.
     */
    idAllocator: IdAllocator = new IdAllocator();

    constructor(public vault: Vault, public frontend: FrontendInterface) {}


    // Core index functions: get a path to a markdown file, and set or delete the contents
    indexSetByPathAndContents(path: string, contents: string): void {
        const parseResult = parseDocument(path, contents, this.idAllocator);
        if (parseResult !== null) {
            const [doc, sectionIdMap] = parseResult;

            const sectionIdList = Array.from(sectionIdMap.keys());
            this.documentByPath.set(path, [doc, sectionIdList]);
            sectionIdMap.forEach((v, k) => this.globalSectionIdMap.set(k, v));

            for (const c of this.listeningClients)
                c.sendDocument(doc);
        }
    }

    indexDeleteByPath(path: string): void {
        const entry = this.documentByPath.get(path);
        if (entry !== undefined) {
            const [_doc, sectionIdList] = entry;
            this.documentByPath.delete(path);
            sectionIdList.forEach(sectionId => this.globalSectionIdMap.delete(sectionId));
            for (const c of this.listeningClients)
                c.removeDocument(path);
        }
    }


    addClient(c: Client) {
        // tell the client about all of the current documents
        for (const [document, _sectionIdList] of this.documentByPath.values()) {
            c.sendDocument(document);
        }
        // this client listens to new changes
        this.listeningClients.push(c);
    }

    removeClient(c: Client) {
        this.listeningClients.remove(c);
    }

    // Client event handlers
    onRevealMessage(msg: RevealMessage) {
        const docId = msg.docId;
        const entry = this.globalSectionIdMap.get(docId);
        if (entry === undefined) {
            return;
        }

        // this is an up to date entry and we have information about it
        console.log(entry.mdNode);
        const file = entry.filename;
        const position = entry.mdNode.position;
        if (position === undefined) {
            return;
        }

        // go to file and position in the editor
        // TODO: use the column itself rather than the start of the line. The column itself didn't act like I wanted it to.
        this.frontend.goTo(file, position.start.line, 0);
    }


    // Vault event handlers
    vaultOnCreateOrModify(maybeFile: TAbstractFile): void {
        // Only care about .md files
        const file = isMarkdownFile(maybeFile);
        if (file === null) {
            return;
        }

        this.vault.cachedRead(file).then(contents => {
            this.indexSetByPathAndContents(file.path, contents);
        });
    }

    vaultOnDelete(maybeFile: TAbstractFile): void {
        this.indexDeleteByPath(maybeFile.path);
    }

    vaultOnRename(maybeFile: TAbstractFile, oldPath: string): void {
        // Trivial solution: delete the old file's state, create a new file
        this.indexDeleteByPath(oldPath);
        this.vaultOnCreateOrModify(maybeFile);
    }
}
