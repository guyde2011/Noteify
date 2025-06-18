import getAllBackends from './allBackends';
import { BackendStatus, BackendStatusToString, DocEvent, DocEventType, DocumentationBackend, DocumentationBackendFile, DocumentationBackendWorkspace } from './interface';
import * as vscode from "vscode";

/**
 * Interface the frontend provides to the session to be notified about new documentation objects.
 */
export interface SessionFrontend<SessionFrontendDoc> {
    addDoc(textDocument: vscode.TextDocument, requestHandle: SessionFrontendRequestHandle, lineOrSymbol: number | string, markdown: string): SessionFrontendDoc;
    delDoc(doc: SessionFrontendDoc): void;
    changeDoc(doc: SessionFrontendDoc, markdown: string): void;
}

/**
 * proxy object giving access to DocumentationBackendFile's request methods for a specific doc, excluding access to create.
 */
export class SessionFrontendRequestHandle {
    constructor(public backendFile: DocumentationBackendFile, public docId: number) {}
    get backendProperties() { return this.backendFile.parentWorkspace.properties; }
    jumpTo(): Promise<BackendStatus> { return this.backendFile.requestJumpTo(this.docId); }
    edit(markdown: string): Promise<BackendStatus> { return this.backendFile.requestEdit(this.docId, markdown); }
    delete(): Promise<BackendStatus> { return this.backendFile.requestDelete(this.docId); }
}

/**
 * Similar to SessionFrontendRequestHandle, but not specific to any doc. It is implemented by Session itself.
 * FrontendComment is NOT allowed to be a number, because then it can't be differentiated from BackendStatus!!
 */
export interface SessionFrontendGlobalRequests<FrontendComment> {
    /**
     * @param textDocument File to link to in the markdown
     * @param lineOrSymbol Position to link to in the markdown
     * @param markdown New markdown contents to add
     */
    create(completeCreation: (requestHandle: SessionFrontendRequestHandle) => FrontendComment, textDocument: vscode.TextDocument, lineOrSymbol: number | string, markdown: string): Promise<BackendStatus | FrontendComment>;
}

export class Session<FrontendComment, Frontend extends SessionFrontend<FrontendComment>> implements SessionFrontendGlobalRequests<FrontendComment> {
    openBackendWorkspaces: Array<DocumentationBackendWorkspace>;
    /**
     * mapping of backend -> index in openBackendWorkspaces where it appears, or -1 if it doesn't appear.
     */
    backendsWorkspacesOpen: Array<number>;
    allBackends: Array<DocumentationBackend>;
    fileBackends: Map<vscode.TextDocument, SessionFile>;
    frontend: Frontend;
    frontendComments: Map<string, FrontendComment>;

    listenerSubscriptions: {dispose(): any;}[];

    /**
     * The Session class holds state over all of the currently open backends, including information about each open file.
     * It sits between the backend and frontend implementations.
     */
    constructor(frontend: Frontend) {
        this.openBackendWorkspaces = [];
        // backends are all closed, initially
        this.backendsWorkspacesOpen = [];
        this.allBackends = getAllBackends();
        for (let i = 0; i < this.allBackends.length; i++) {
            this.backendsWorkspacesOpen.push(-1);
        }
        this.fileBackends = new Map();
        this.frontend = frontend;
        this.frontendComments = new Map();
        this.listenerSubscriptions = [];

        // listen to stuff
        this.listenToTextDocuments();
    }

    /**
     * Called once, during initialization. Looks at all open textDocuments.
     */
    listenToTextDocuments(): void {
        // Initialize openFileUris with all of the current text docuemnt URIs.
        // This does not need to notify any backend because none exist yet.
        for (let doc of vscode.workspace.textDocuments) {
            this.fileBackends.set(doc, new SessionFile(doc, this.onDocEvent.bind(this)));
        }

        // new documents that are being opened
        let ev = vscode.workspace.onDidOpenTextDocument(textDocument => {
            // currently, no backends
            const sessionFile = new SessionFile(textDocument, this.onDocEvent.bind(this));
            this.fileBackends.set(textDocument, sessionFile);

            // asynchronously add every existing backend to this file
            for (let i = 0; i < this.openBackendWorkspaces.length; i++) {
                sessionFile.openFor(this.openBackendWorkspaces[i], i);
            }
        });
        this.listenerSubscriptions.push(ev);
        // documents that have been closed
        ev = vscode.workspace.onDidCloseTextDocument(textDocument => {
            const sessionFile = this.fileBackends.get(textDocument);
            if (sessionFile !== undefined) {
                sessionFile.close();
                this.fileBackends.delete(textDocument);
            }
        });
        this.listenerSubscriptions.push(ev);
    }

    onDocEvent(textDocument: vscode.TextDocument, backendIndex: number, backendFile: DocumentationBackendFile, docEvent: DocEvent): void {
        console.log(`Got event: ${docEvent.type} for ${textDocument.uri}`);

        switch (docEvent.type) {
            case DocEventType.Add: {
                // When changing something here, you probably want to look at create(), too
                const docId = docEvent.docId;
                const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
                const newComment = this.frontend.addDoc(textDocument, new SessionFrontendRequestHandle(backendFile, docId), docEvent.lineOrSymbol, docEvent.markdown);
                console.assert(!this.frontendComments.has(key));
                this.frontendComments.set(key, newComment);
                break;
            }
            case DocEventType.Delete: {
                const docId = docEvent.docId;
                const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
                const deletedComment = this.frontendComments.get(key);
                if (deletedComment !== undefined) {
                    this.frontend.delDoc(deletedComment);
                    this.frontendComments.delete(key);
                } else {
                    console.error("got delete event for undefined comment");
                }
                break;
            }
            case DocEventType.Change: {
                const docId = docEvent.docId;
                const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
                const changedComment = this.frontendComments.get(key);
                if (changedComment !== undefined) {
                    this.frontend.changeDoc(changedComment, docEvent.markdown);
                } else {
                    console.error("got change event for undefined comment");
                }
                break;
            }
            default: {
                console.error(`unknown doc event: ${docEvent}`);
                break;
            }
        }
    }

    /**
     * Implementation of the SessionFrontendGlobalRequests interface
     */
    async create(completeCreation: (requestHandle: SessionFrontendRequestHandle) => FrontendComment, textDocument: vscode.TextDocument, lineOrSymbol: number | string, markdown: string): Promise<BackendStatus> {
        // iterate over applicable backends, in order of precedence
        let backendIndex = -1;
        let createBackend = undefined;
        for (let i = 0; i < this.backendsWorkspacesOpen.length; i++) {
            backendIndex = this.backendsWorkspacesOpen[i];
            createBackend = this.openBackendWorkspaces[backendIndex];
            if (createBackend.properties.featureFlags.createDoc) {
                break;
            }
        }

        if (createBackend === undefined || !createBackend.properties.featureFlags.createDoc) {
            return BackendStatus.Unsupported;
        }

        const sessionFile = this.fileBackends.get(textDocument);
        if (sessionFile === undefined) {
            return BackendStatus.NotFound;
        }

        const backendFile = await sessionFile.waitForBackend(createBackend);
        if (backendFile === null || sessionFile.isClosed) {
            return BackendStatus.NotFound;
        }

        // the file is NOT closed now
        const createResult = await backendFile.requestCreate(lineOrSymbol, markdown);
        if (typeof createResult === "number") {
            // some weird status
            if (createResult === BackendStatus.Success) {
                return BackendStatus.Other;
            } else {
                return createResult;
            }
        }

        // Create frontend comment object (as in onDocEvent)
        const docId = createResult.docId;
        const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
        console.assert(!this.frontendComments.has(key));
        const newComment = completeCreation(new SessionFrontendRequestHandle(backendFile, docId));
        this.frontendComments.set(key, newComment);
        return BackendStatus.Success;
    }

    /**
     * load() may be called multiple times, and will always try loading every possible documentation backend.
     */
    async load(): Promise<"no workspace" | "ok"> {
        // We need the workspace to have a URI
        const workspaceRawUri = vscode.workspace.workspaceFile;
        if (workspaceRawUri === undefined) {
            return "no workspace";
        }
        const workspaceUri = workspaceRawUri.toString();

        // Some of the backends that weren't valid before might become valid now; for example, listening sockets that have been opened.
        let tasks = [];
        for (let i = 0; i < this.allBackends.length; i++) {
            const backend = this.allBackends[i];

            // skip over already open backends
            if (this.backendsWorkspacesOpen[i] !== -1) {
                continue;
            }

            // try to initialize uninitialized backends
            if (!backend.isInitialized) {
                console.log(`trying to initialize backend ${backend.name}`);
                await backend.init();
                if (!backend.isInitialized) {
                    continue;
                }
                console.log(`initialized backend ${backend.name}`);
            }

            const task = backend.open(workspaceUri).then(newWorkspaceBackend => {
                if (typeof newWorkspaceBackend === "number") {  // BackendStatus
                    console.log(`open for backend ${backend.name} failed with status code ${BackendStatusToString(newWorkspaceBackend)}`);
                } else {
                    console.log(`successfuly opened backend ${backend.name}`);
                    const backendIndex = this.openBackendWorkspaces.length;
                    this.openBackendWorkspaces.push(newWorkspaceBackend);
                    this.backendsWorkspacesOpen[i] = backendIndex;

                    // asynchronously add this backend to every file
                    this.fileBackends.forEach((sessionFile, _textDocument, _map) => {
                        sessionFile.openFor(newWorkspaceBackend, backendIndex);
                    });
                }
            });
            tasks.push(task);
        }

        await Promise.all(tasks);
        return "ok";
    }

    dispose(): void {
        // close generic subscriptions
        for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
            this.listenerSubscriptions[i].dispose();
        }
        this.listenerSubscriptions = [];

        // close backend files before their workspaces
        this.fileBackends.forEach((sessionFile, _textDocument, _map) => {
            sessionFile.close();
        })
        this.fileBackends = new Map();

        // delete frontend comments
        this.frontendComments.forEach((frontendComment, _key, _map) => {
            this.frontend.delDoc(frontendComment);
        });

        // close backend workspaces
        for (let workspace of this.openBackendWorkspaces) {
            workspace.dispose();
        }
        this.openBackendWorkspaces = [];

        // other
        this.allBackends = [];
        this.backendsWorkspacesOpen = [];
    }
}

export class SessionFile {
    backendFiles: Array<DocumentationBackendFile<any>> = [];
    waitForBackendResolutions: Map<DocumentationBackendWorkspace<any>, ((_: DocumentationBackendFile | null) => void)[]> = new Map();
    isClosed: boolean = false;
    constructor(
        public textDocument: vscode.TextDocument,
        public onDocEvent: (textDoc: vscode.TextDocument, backendIndex: number, backendFile: DocumentationBackendFile<any>, docEvent: DocEvent) => void,
    )
    {}

    openFor(workspaceBackend: DocumentationBackendWorkspace<any>, backendIndex: number): void {
        console.log(`Opening ${this.textDocument.uri} for backend ${workspaceBackend}`);
        const listener = this.onDocEvent.bind(null, this.textDocument, backendIndex);
        workspaceBackend.openFile(this.textDocument.uri.toString(), listener).then(backendFile => {
            if (this.isClosed) {
                console.log("Lost the race: file got closed before its backend got created.");
                backendFile.close();
            } else {
                console.log(`Successfuly opened ${this.textDocument.uri} for backend ${workspaceBackend}`);
                this.backendFiles.push(backendFile);
                // Support for waiting for a file to get opened
                const resolutions = this.waitForBackendResolutions.get(backendFile);
                if (resolutions !== undefined) {
                    for (let resolve of resolutions) {
                        resolve(backendFile);
                    }
                }
            }
        });
    }

    /**
     * Waits for a specific backend to be activated for this file.
     * @param workspaceBackend Backend from which the file is opened
     */
    waitForBackend(workspaceBackend: DocumentationBackendWorkspace<any>): Promise<DocumentationBackendFile<any> | null> {
        if (this.isClosed) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            // Is it already active?
            for (let file of this.backendFiles) {
                if (file.parentWorkspace === workspaceBackend) {
                    resolve(file);
                }
            }

            // Otherwise, store the promise
            const resolutions = this.waitForBackendResolutions.get(workspaceBackend);
            if (resolutions !== undefined) {
                resolutions.push(resolve);
            } else {
                this.waitForBackendResolutions.set(workspaceBackend, [resolve]);
            }
        });
    }

    close(): void {
        this.isClosed = true;
        for (let backendFile of this.backendFiles) {
            backendFile.close();
        }
        this.backendFiles = [];
        for (let resolutions of this.waitForBackendResolutions.values()) {
            for (let resolve of resolutions) {
                resolve(null);
            }
        }
        this.waitForBackendResolutions.clear();
    }
}
