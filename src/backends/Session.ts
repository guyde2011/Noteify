import getAllBackends from './allBackends';
import { BackendStatusToString, DocEvent, DocEventType, DocumentationBackend, DocumentationBackendFile, DocumentationBackendWorkspace } from './interface';
import * as vscode from "vscode";

/**
 * Interface the frontend provides to the session to be notified about new documentation objects.
 */
export interface SessionFrontend<SessionFrontendDoc> {
    addDoc(textDocument: vscode.TextDocument, lineOrSymbol: number | string, markdown: string): SessionFrontendDoc;
    delDoc(doc: SessionFrontendDoc): void;
    changeDoc(doc: SessionFrontendDoc, markdown: string): void;
}

export default class Session<FrontendComment, Frontend extends SessionFrontend<FrontendComment>> {
    openBackendWorkspaces: Array<DocumentationBackendWorkspace>;
    backendsWorkspacesOpen: Array<boolean>;
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
        for (let i = 0; i < this.allBackends.length; i++)
            this.backendsWorkspacesOpen.push(false);
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
            for (let worskpaceBackend of this.openBackendWorkspaces) {
                sessionFile.openFor(worskpaceBackend);
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

    onDocEvent(textDocument: vscode.TextDocument, workspaceBackend: DocumentationBackendWorkspace, docEvent: DocEvent): void {
        console.log(`Got event: ${docEvent.type} for ${textDocument.uri}`);
        let backendIndex = this.openBackendWorkspaces.indexOf(workspaceBackend);
        console.assert(backendIndex != -1);

        switch (docEvent.type) {
            case DocEventType.Add: {
                const docId = docEvent.docId;
                const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
                const newComment = this.frontend.addDoc(textDocument, docEvent.lineOrSymbol, docEvent.markdown);
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
     * load() may be called multiple times, and will always try loading every possible documentation backend.
     */
    async load(): Promise<"no workspace" | "ok"> {
        // We need the workspace to have a URI
        const workspaceRawUri = vscode.workspace.workspaceFile;
        if (workspaceRawUri === undefined)
            return "no workspace";
        const workspaceUri = workspaceRawUri.toString();

        // Some of the backends that weren't valid before might become valid now; for example, listening sockets that have been opened.
        let tasks = [];
        for (let i = 0; i < this.allBackends.length; i++) {
            const backend = this.allBackends[i];

            // skip over already open backends
            if (this.backendsWorkspacesOpen[i])
                continue;

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
                    this.openBackendWorkspaces.push(newWorkspaceBackend);
                    this.backendsWorkspacesOpen[i] = true;

                    // asynchronously add this backend to every file
                    this.fileBackends.forEach((sessionFile, _textDocument, _map) => {
                        sessionFile.openFor(newWorkspaceBackend);
                    })
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
    backendFiles: Array<DocumentationBackendFile> = [];
    isClosed: boolean = false;
    constructor(
        public textDocument: vscode.TextDocument,
        public onDocEvent: (textDoc: vscode.TextDocument, workspaceBackend: DocumentationBackendWorkspace, docEvent: DocEvent) => void,
    )
    {}

    openFor(workspaceBackend: DocumentationBackendWorkspace): void {
        console.log(`Opening ${this.textDocument.uri} for backend ${workspaceBackend}`)
        const listener = this.onDocEvent.bind(null, this.textDocument, workspaceBackend);
        workspaceBackend.openFile(this.textDocument.uri.toString(), listener).then(backendFile => {
            if (this.isClosed) {
                console.log("Lost the race: file got closed before its backend got created.");
                backendFile.close();
            } else {
                console.log(`Successfuly opened ${this.textDocument.uri} for backend ${workspaceBackend}`)
                this.backendFiles.push(backendFile);
            }
        });
    }

    close(): void {
        this.isClosed = true;
        for (let backendFile of this.backendFiles) {
            backendFile.close();
        }
        this.backendFiles = [];
    }
}