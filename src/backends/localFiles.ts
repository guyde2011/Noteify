import { Uri } from "vscode";
import * as vscode from "vscode";
import { readFile, writeFile } from "../utils";
import { DocumentationBackend, BackendStatus, DocumentationBackendWorkspace, DocEvent, DocEventType, DocumentationBackendFile } from "./interface";
import { TextDecoder } from "util";


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
    properties = { featureFlags: { jumpTo: false, editDoc: false, deleteDoc: false, createDoc: false } };

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

    onUpdatedFileUri(uri: Uri) {
        vscode.workspace.fs.readFile(uri).then(contents => {
            const oldData = this.markdownFiles.get(uri.toString());
            if (oldData !== undefined) {
                // Remove from file indexes...
            }
            const newData = LocalMarkdownFile.fromBytes(contents);
            // Add to file indexes...
            this.markdownFiles.set(uri.toString(), newData);
            // For now: just forcefully updating every file
            this.updateAllSourceFiles();
        });
    }

    onDeletedFileUri(uri: Uri) {
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
};

export class LocalFilesBackendFile implements DocumentationBackendFile<LocalFilesBackendFile> {
    nextId: number = 0
    markdownEntriesByLineOrSymbol: Map<number | string, FileMarkdownEntry> = new Map();

    constructor(public parentWorkspace: LocalFilesBackendWorkspace, public fileUri: string, public listener: (_: LocalFilesBackendFile, _e: DocEvent) => void) {}

    async requestJumpTo(docId: number): Promise<BackendStatus> {
        return BackendStatus.Unsupported;
    }

    async requestEdit(docId: number, markdown: string): Promise<BackendStatus> {
        return BackendStatus.Unsupported;
    }

    async requestDelete(docId: number): Promise<BackendStatus> {
        return BackendStatus.Unsupported;
    }

    async requestCreate(docId: number, markdown: string): Promise<BackendStatus | { docId: number; }> {
        return BackendStatus.Unsupported;
    }

    assignMarkdown(lineOrSymbol: number | string, markdown: string) {
        const entry = this.markdownEntriesByLineOrSymbol.get(lineOrSymbol);
        if (entry === undefined) {
            const id = this.nextId++;
            const newEntry = {docId: id, lineOrSymbol: lineOrSymbol, markdown: markdown};
            this.markdownEntriesByLineOrSymbol.set(lineOrSymbol, newEntry);
            this.listener(this, {
                type: DocEventType.Add,
                ...newEntry
            });
        } else {
            entry["markdown"] = markdown;
            this.listener(this, {
                type: DocEventType.Change,
                ...entry
            });
        }
    }

    incRefresh(linkReferences: LocalMarkdownReference[]) {
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
                    this.assignMarkdown(maybeLineOrSymbol, linkRef.documentationContents);
                }
            }
        }
    }

    close(): void {
        this.parentWorkspace.closeChildFile(this);
    }
}

class LocalMarkdownFile {
    private constructor(public linkReferences: LocalMarkdownReference[]) {}

    static fromBytes(bytes: Uint8Array): LocalMarkdownFile {
        // look for any possible References
        let linkReferences = [];

        // Indexing should be fast and May contain false positives.

        let docPosition = 0;
        let linkDestinationBytes: number[] = [];
        let linkDestination: string = "";
        let documentationContentsBytes: number[] = [];
        let documentationContents: string = "";
        // -1: line does not match.
        // 0: new line. 1: it's a title's hashtags. 2: spaces after the hashtags. 3: a link's square brackets. 4: we expect the brackets. 5: a link's destination. 6: a link ended - ignore until end of line.
        // 7: newlines before documentation contents. 8: documentation contents. 9: a single newline in the documentation contents - may return to 8, or leave due to an extra newline or a #.
        let matchState = 0;

        for (let i = 0; i <= bytes.length; i++) {
            const b = i < bytes.length ? bytes[i] : "\n".charCodeAt(0);

            if (b == "\n".charCodeAt(0)) {
                if (matchState == 6 || matchState == 7) {
                    matchState = 7;
                } else if (matchState == 8) {
                    documentationContentsBytes.push(b);
                    matchState = 9;
                } else {
                    if (matchState == 9) {
                        // we are after two newlines in a row: this was a successful parse.
                        try {
                            documentationContents = new TextDecoder("utf-8").decode(new Uint8Array(documentationContentsBytes));
                            linkReferences.push(new LocalMarkdownReference(linkDestination, documentationContents, docPosition));
                        } catch (e) {}
                    }
                    // new line
                    docPosition = i;
                    linkDestinationBytes = [];
                    documentationContentsBytes = [];
                    matchState = 0;
                }
            } else if ((matchState == 0 || matchState == 1 || matchState == 9) && b == "#".charCodeAt(0)) {
                if (matchState == 0 || matchState == 1) {
                    // hashtags put us into title mode
                    matchState = 1
                } else if (matchState == 9) {
                    // rather than two lines in a row, there is new line with a title interrupting us
                    try {
                        documentationContents = new TextDecoder("utf-8").decode(new Uint8Array(documentationContentsBytes));
                        linkReferences.push(new LocalMarkdownReference(linkDestination, documentationContents, docPosition));
                    } catch (e) {}

                    // also, a new line just started
                    docPosition = i - 1;
                    linkDestinationBytes = [];
                    documentationContentsBytes = [];
                    matchState = 1;
                }
            } else if ((matchState == 1 || matchState == 2) && b == " ".charCodeAt(0)) {
                // spaces put us into padding mode
                matchState = 2;
            } else if ((matchState == 1 || matchState == 2) && b == "[".charCodeAt(0)) {
                // [ puts us into square brackets mode
                matchState = 3;
            } else if (matchState == 3) {
                if (b == "]".charCodeAt(0)) {
                    matchState = 4;
                }
            } else if (matchState == 4 && b == "(".charCodeAt(0)) {
                matchState = 5;
            } else if (matchState == 5) {
                if (b == ")".charCodeAt(0)) {
                    matchState = 6;
                    try {
                        linkDestination = new TextDecoder("utf-8").decode(new Uint8Array(linkDestinationBytes));
                    } catch (e) {
                        matchState = -1;
                    }
                } else {
                    linkDestinationBytes.push(b);
                }
            } else if (matchState == 6) {
                // do nothing. we don't care until the next line.
            } else if (matchState == 7 || matchState == 8 || matchState == 9) {
                // documentation contents
                documentationContentsBytes.push(b);
                matchState = 8;
            } else {
                // unexpected character
                matchState = -1;
            }
        }

        return new LocalMarkdownFile(linkReferences);
    }
}

class LocalMarkdownReference {
    constructor(public linkDestination: string, public documentationContents: string, public docPosition: number) {}
}
