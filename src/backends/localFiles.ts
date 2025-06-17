import { Uri } from "vscode";
import * as vscode from "vscode";
import { DocumentationBackend, BackendStatus, DocumentationBackendWorkspace, DocEvent, DocEventType, DocumentationBackendFile } from "./interface";
import { TextDecoder, TextEncoder } from "util";


export class LocalFilesBackend implements DocumentationBackend {
    isInitialized: boolean = false;
    name: string = "Local Files"

    async init(): Promise<void> {
        this.isInitialized = true;
    }

    async open(workspaceUri: string): Promise<BackendStatus | LocalFilesBackendWorkspace> {
        return new LocalFilesBackendWorkspace(workspaceUri);
    }
}

export class LocalFilesBackendWorkspace implements DocumentationBackendWorkspace {
    // mandatory for backend workspaces
    workspaceUri: string;
    properties = { featureFlags: { jumpTo: true, editDoc: true, deleteDoc: false, createDoc: false }, viaName: "Noteify via local files" };

    // implementation of local files backend
    listenerSubscriptions: {dispose(): any;}[] = [];
    /**
     * map of markdown filename Uri strings -> parsed Markdown objects
     */
    markdownFiles: Map<string, LocalMarkdownFile> = new Map();
    /**
     * map of source filename Uri strings -> the BackendFile object
     */
    sourceFiles: Map<string, LocalFilesBackendFile> = new Map();

    constructor(workspaceUri: string) {
        this.workspaceUri = workspaceUri;
        const fsWatcher = vscode.workspace.createFileSystemWatcher("**/**.md");
        this.listenerSubscriptions.push(fsWatcher);
        this.listenerSubscriptions.push(fsWatcher.onDidChange(this.onUpdatedFileUri.bind(this)));
        this.listenerSubscriptions.push(fsWatcher.onDidCreate(this.onUpdatedFileUri.bind(this)));
        this.listenerSubscriptions.push(fsWatcher.onDidDelete(this.onDeletedFileUri.bind(this)));
        // load initial files
        vscode.workspace.findFiles("**/**.md").then(initialUris => {
            initialUris.forEach(this.onUpdatedFileUri.bind(this))
        })
    }

    onUpdatedFileUri(uri: Uri): void {
        vscode.workspace.fs.readFile(uri).then(contents => {
            const oldData = this.markdownFiles.get(uri.toString());
            if (oldData !== undefined) {
                // Remove from file indexes...
            }
            const newData = LocalMarkdownFile.fromBytes(uri, contents);
            // Add to file indexes...
            this.markdownFiles.set(uri.toString(), newData);
            // For now: just forcefully updating every file
            this.updateAllSourceFiles();
        });
    }

    onDeletedFileUri(uri: Uri): void {
        const markdownFile = this.markdownFiles.get(uri.toString());
        if (markdownFile !== undefined) {
            // Remove from file indexes
            this.markdownFiles.delete(uri.toString());
            // For now: just forcefully updating every file
            this.updateAllSourceFiles();
        }
    }

    /**
     * openFile and closeChildFile should pair up to work well together
     */
    async openFile(fileUri: string, listener: (_: LocalFilesBackendFile, _e: DocEvent) => void): Promise<LocalFilesBackendFile> {
        const fileBackend = new LocalFilesBackendFile(this, fileUri, listener);
        this.sourceFiles.set(fileUri, fileBackend);
        return fileBackend;
    }

    closeChildFile(fileBackend: LocalFilesBackendFile) {
        // lose the reference to it, so that we immediately stop sending it new events
        this.sourceFiles.delete(fileBackend.fileUri);
    }

    dispose(): void {
        for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
            this.listenerSubscriptions[i].dispose();
        }
        this.listenerSubscriptions = [];
        // Note that we may have pending promises that try to update backend files. The way we notify them of their cancellation is by losing the reference to the source file.
        this.sourceFiles = new Map();
    }

    /**
     * This is the "worse is better" implementation. I am not optimizing anything yet.
     */
    updateAllSourceFiles(): void {
        const allReferences = Array.from(this.markdownFiles.values()).map(x => x.linkReferences).reduce((a, b) => a.concat(b), []);
        for (let fileBackend of this.sourceFiles.values()) {
            fileBackend.incRefresh(allReferences);
        }
    }
}

interface FileMarkdownEntry {
    docId: number;
    lineOrSymbol: number | string;
    markdown: string;
    sourceLineNumber: number;
    sourceFileUri: Uri;
};

export class LocalFilesBackendFile implements DocumentationBackendFile<LocalFilesBackendFile> {
    nextId: number = 0
    markdownEntriesByLineOrSymbol: Map<number | string, FileMarkdownEntry> = new Map();
    markdownEntriesById: Map<number, FileMarkdownEntry> = new Map();

    constructor(public parentWorkspace: LocalFilesBackendWorkspace, public fileUri: string, public listener: (_: LocalFilesBackendFile, _e: DocEvent) => void) {}

    async requestJumpTo(docId: number): Promise<BackendStatus> {
        const entry = this.markdownEntriesById.get(docId);

        if (entry !== undefined) {
            const position = new vscode.Position(entry.sourceLineNumber, 0);
            vscode.window.showTextDocument(entry.sourceFileUri, { selection: new vscode.Range(position, position) });
            return BackendStatus.Success;
        } else {
            return BackendStatus.NotFound;
        }
    }

    async requestEdit(docId: number, markdown: string): Promise<BackendStatus> {
        const entry = this.markdownEntriesById.get(docId);

        if (entry !== undefined) {
            entry.markdown = markdown;
            const bytes = await vscode.workspace.fs.readFile(entry.sourceFileUri);

            // find the line by its index
            let i = 0, lineIndex = 0;
            for (; i < bytes.length && lineIndex < entry.sourceLineNumber; i++) {
                const b = bytes[i];
                if (b == "\n".charCodeAt(0)) {
                    lineIndex++;
                }
            }

            // find where the contents start and end
            // basic validation for the title line:
            if (i >= bytes.length - 1 || bytes[i++] != "#".charCodeAt(0)) {
                console.log(`title was not found: ${bytes[i]}, ${i + 1 < bytes.length ? bytes[i + 1] : -1}`);
                return BackendStatus.NotFound;
            }

            // go to next line
            for (; i < bytes.length; i++) {
                const b = bytes[i];
                if (b == "\n".charCodeAt(0))
                    break;
            }

            // skip preceding newlines
            for (; i < bytes.length; i++) {
                const b = bytes[i];
                if (b != "\n".charCodeAt(0))
                    break;
            }

            const startOffset = i;

            // find end offset
            for (; i < bytes.length - 1; i++) {
                const b = bytes[i];
                const c = bytes[i + 1];
                if (b == "\n".charCodeAt(0) && c == "\n".charCodeAt(0) || b == "\n".charCodeAt(0) && c == "#".charCodeAt(0))
                    break;
            }

            const endOffset = i;

            if (startOffset == endOffset) {
                console.log("contents were not found");
                return BackendStatus.NotFound;
            }

            const markdownBytes = new TextEncoder().encode(markdown);

            // replace the range between startOffset and endOffset
            const newBytes = new Uint8Array(bytes.length - (endOffset - startOffset) + markdownBytes.length);
            newBytes.set(bytes.subarray(0, startOffset), 0);
            newBytes.set(markdownBytes, startOffset);
            newBytes.set(bytes.subarray(endOffset, bytes.length), startOffset + markdownBytes.length);

            await vscode.workspace.fs.writeFile(entry.sourceFileUri, newBytes);
            // NOTE: This WILL send a Change event, which is unnecessary in the API. But it doesn't really matter.
            this.parentWorkspace.onUpdatedFileUri(entry.sourceFileUri);

            return BackendStatus.Success;
        } else {
            console.log("edited entry was not found");
            return BackendStatus.NotFound;
        }
    }

    async requestDelete(docId: number): Promise<BackendStatus> {
        return BackendStatus.Unsupported;
    }

    async requestCreate(docId: number, markdown: string): Promise<BackendStatus | { docId: number; }> {
        return BackendStatus.Unsupported;
    }

    assignMarkdown(lineOrSymbol: number | string, markdown: string, sourceLineNumber: number, sourceFileUri: Uri) {
        const entry = this.markdownEntriesByLineOrSymbol.get(lineOrSymbol);
        if (entry === undefined) {
            const docId = this.nextId++;
            const newEntry = {docId, lineOrSymbol, markdown, sourceLineNumber, sourceFileUri};
            this.markdownEntriesByLineOrSymbol.set(lineOrSymbol, newEntry);
            this.markdownEntriesById.set(docId, newEntry);
            this.listener(this, {
                type: DocEventType.Add,
                ...newEntry
            });
        } else {
            // don't forget to assign new fields here too!
            entry.markdown = markdown;
            entry.sourceLineNumber = sourceLineNumber;
            entry.sourceFileUri = sourceFileUri;

            this.listener(this, {
                type: DocEventType.Change,
                ...entry
            });
        }
    }

    removeMarkdown(lineOrSymbol: number | string) {
        const entry = this.markdownEntriesByLineOrSymbol.get(lineOrSymbol);
        if (entry !== undefined) {
            this.listener(this, {
                type: DocEventType.Delete,
                docId: entry.docId
            });

            // this is safe, apparently, even when iterating
            this.markdownEntriesByLineOrSymbol.delete(lineOrSymbol);
            this.markdownEntriesById.delete(entry.docId);
        }
    }

    incRefresh(linkReferences: LocalMarkdownReference[]) {
        let newSymbolSet: Set<number | string> = new Set();

        for (let linkRef of linkReferences) {
            if (linkRef.linkDestination.startsWith(this.fileUri)) {
                // the link points to here!
                const parsedUri = vscode.Uri.parse(linkRef.linkDestination);
                const shouldBeLineOrSymbol = parsedUri.fragment;
                let maybeLineOrSymbol: string | number | undefined = undefined;

                if (/^\d/.test(shouldBeLineOrSymbol)) {
                    const line = Number.parseInt(shouldBeLineOrSymbol);
                    if (!Number.isNaN(line))
                        maybeLineOrSymbol = line;
                } else if (shouldBeLineOrSymbol != "") {
                    maybeLineOrSymbol = shouldBeLineOrSymbol;
                }

                if (maybeLineOrSymbol !== undefined) {
                    newSymbolSet.add(maybeLineOrSymbol);
                    this.assignMarkdown(maybeLineOrSymbol, linkRef.documentationContents, linkRef.lineNumber, linkRef.markdownFile.uri);
                }
            }
        }

        // delete symbols not in newSymbolSet
        this.markdownEntriesByLineOrSymbol.forEach((_value, lineOrSymbol) => {
            if (!newSymbolSet.has(lineOrSymbol)) {
                this.removeMarkdown(lineOrSymbol);
            }
        })
    }

    close(): void {
        this.parentWorkspace.closeChildFile(this);
    }
}

class LocalMarkdownFile {
    private constructor(public uri: Uri, public linkReferences: LocalMarkdownReference[]) {}

    static fromBytes(uri: Uri, bytes: Uint8Array): LocalMarkdownFile {
        // look for any possible References
        let linkReferences: LocalMarkdownReference[] = [];
        const result = new LocalMarkdownFile(uri, linkReferences);

        // Indexing should be fast and May contain false positives.
        let lineNumber = 0;
        let matchLineNumber = 0;
        let linkDestinationBytes: number[] = [];
        let linkDestination: string = "";
        let documentationContentsBytes: number[] = [];
        let documentationContents: string = "";
        // -1: line does not match.
        // 0: new line. 1: it's a title's hashtags. 2: spaces after the hashtags. 3: a link's square brackets. 4: we expect the brackets. 5: a link's destination. 6: a link ended - ignore until end of line.
        // 7: newlines before documentation contents. 8: documentation contents. 9: a single newline in the documentation contents - may return to 8, or leave due to an extra newline or a #.
        let matchState = 0;

        for (let i = 0; i < bytes.length + 2; i++) {
            const b = i < bytes.length ? bytes[i] : "\n".charCodeAt(0);

            if (b === "\n".charCodeAt(0)) {
                if (matchState === 6 || matchState === 7) {
                    matchState = 7;
                } else if (matchState === 8) {
                    documentationContentsBytes.push(b);
                    matchState = 9;
                } else {
                    if (matchState === 9) {
                        // we are after two newlines in a row: this was a successful parse.
                        try {
                            documentationContents = new TextDecoder("utf-8").decode(new Uint8Array(documentationContentsBytes));
                            linkReferences.push(new LocalMarkdownReference(result, linkDestination, documentationContents, matchLineNumber));
                        } catch (e) {}
                    }
                    // new line, after which starts the match
                    matchLineNumber = lineNumber + 1;
                    linkDestinationBytes = [];
                    documentationContentsBytes = [];
                    matchState = 0;
                }
                // regardless...
                lineNumber++;
            } else if ((matchState === 0 || matchState === 1 || matchState === 9) && b === "#".charCodeAt(0)) {
                if (matchState === 0 || matchState === 1) {
                    // hashtags put us into title mode
                    matchState = 1
                } else if (matchState === 9) {
                    // rather than two lines in a row, there is new line with a title interrupting us
                    try {
                        documentationContents = new TextDecoder("utf-8").decode(new Uint8Array(documentationContentsBytes));
                        linkReferences.push(new LocalMarkdownReference(result, linkDestination, documentationContents, matchLineNumber));
                    } catch (e) {}

                    // also, a new match just started
                    matchLineNumber = lineNumber;
                    linkDestinationBytes = [];
                    documentationContentsBytes = [];
                    matchState = 1;
                }
            } else if ((matchState === 1 || matchState === 2) && b === " ".charCodeAt(0)) {
                // spaces put us into padding mode
                matchState = 2;
            } else if ((matchState === 1 || matchState === 2) && b === "[".charCodeAt(0)) {
                // [ puts us into square brackets mode
                matchState = 3;
            } else if (matchState === 3) {
                if (b === "]".charCodeAt(0)) {
                    matchState = 4;
                }
            } else if (matchState === 4 && b === "(".charCodeAt(0)) {
                matchState = 5;
            } else if (matchState === 5) {
                if (b === ")".charCodeAt(0)) {
                    matchState = 6;
                    try {
                        linkDestination = new TextDecoder("utf-8").decode(new Uint8Array(linkDestinationBytes));
                    } catch (e) {
                        matchState = -1;
                    }
                } else {
                    linkDestinationBytes.push(b);
                }
            } else if (matchState === 6) {
                // do nothing. we don't care until the next line.
            } else if (matchState === 7 || matchState === 8 || matchState === 9) {
                // documentation contents
                documentationContentsBytes.push(b);
                matchState = 8;
            } else {
                // unexpected character
                matchState = -1;
            }
        }

        return result;
    }
}

class LocalMarkdownReference {
    constructor(public markdownFile: LocalMarkdownFile, public linkDestination: string, public documentationContents: string, public lineNumber: number) {}
}
