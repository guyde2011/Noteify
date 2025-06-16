import getAllBackends from './allBackends';
import { BackendStatusToString, DocEvent, DocEventType, DocumentationBackend, DocumentationBackendFile, DocumentationBackendWorkspace } from './interface';
import * as vscode from "vscode";

export default class Session {
    openBackendWorkspaces: Array<DocumentationBackendWorkspace>;
    backendsWorkspacesOpen: Array<boolean>;
    allBackends: Array<DocumentationBackend>;
    fileBackends: Map<vscode.TextDocument, SessionFile>;
    subscriptions: {
        /**
         * Function to clean up resources.
         */
        dispose(): any;
    }[];

    /**
     * The Session class holds state over all of the currently open backends, including information about each open file.
     * It sits between the backend and frontend implementations.
     */
    constructor() {
        this.openBackendWorkspaces = [];
        // backends are all closed, initially
        this.backendsWorkspacesOpen = [];
        this.allBackends = getAllBackends();
        for (let i = 0; i < this.allBackends.length; i++)
            this.backendsWorkspacesOpen.push(false);
        this.fileBackends = new Map();
        this.subscriptions = [];

        // listen to stuff
        this.listenToTextDocuments();
    }

    /**
     * Called once, during initialization.
     */
    listenToTextDocuments(): void {
        // Initialize openFileUris with all of the current text docuemnt URIs.
        // This does not need to notify any backend because none exist yet.
        for (let doc of vscode.workspace.textDocuments) {
            this.fileBackends.set(doc, new SessionFile(doc));
        }

        // new documents that are being opened
        let ev = vscode.workspace.onDidOpenTextDocument(textDocument => {
            // currently, no backends
            const sessionFile = new SessionFile(textDocument);
            this.fileBackends.set(textDocument, sessionFile);

            // asynchronously add every existing backend to this file
            for (let worskpaceBackend of this.openBackendWorkspaces) {
                sessionFile.openFor(worskpaceBackend);
            }
        });
        this.subscriptions.push(ev);
        // documents that have been closed
        ev = vscode.workspace.onDidCloseTextDocument(textDocument => {
            this.fileBackends.get(textDocument)?.close();
            this.fileBackends.delete(textDocument);
            // TODO: something for frontend? onDocumentClosed?
        });
        this.subscriptions.push(ev);
    }

    /**
     * load() may be called multiple times, and will always try loading every possible documentation backend.
     */
    async load(): Promise<void> {
        // We need the workspace to have a URI
        const workspaceRawUri = vscode.workspace.workspaceFile;
        if (workspaceRawUri === undefined)
            return;
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
                await backend.init();
                if (!backend.isInitialized) {
                    continue;
                }
            }

            const task = backend.open(workspaceUri).then(result => {
                if (typeof result === "number") {  // BackendStatus
                    console.log(`open for backend ${backend.name} failed with status code ${BackendStatusToString(result)}`);
                } else {
                    this.openBackendWorkspaces.push(result);
                    this.backendsWorkspacesOpen[i] = true;
                }
            });
            tasks.push(task);
        }
    }

    dispose(): void {
        for (let workspace of this.openBackendWorkspaces) {
            workspace.dispose();
        }
        this.openBackendWorkspaces = [];
        this.backendsWorkspacesOpen = [];
        this.allBackends = [];
        for (let sub of this.subscriptions) {
            sub.dispose();
        }
        this.subscriptions = [];
    }
}

export class SessionFile {
    backendFiles: Array<DocumentationBackendFile> = [];
    isClosed: boolean = false;
    constructor(
        public textDocument: vscode.TextDocument,
        public onDocEvent: (f: SessionFile, workspaceBackend: DocumentationBackendWorkspace, docEvent: DocEvent) => void,
    )
    {}

    openFor(workspaceBackend: DocumentationBackendWorkspace): void {
        workspaceBackend.openFile(this.textDocument.uri.toString()).then(backendFile => {
            if (this.isClosed) {
                console.log("Lost the race: file got closed before its backend got created.");
                backendFile.close();
            } else {
                this.backendFiles.push(backendFile);
                backendFile.setListener(this.gotDocEvent.bind(this, backendFile.parentWorkspace));
            }
        });
    }

    gotDocEvent(workspaceBackend: DocumentationBackendWorkspace, docEvent: DocEvent): void {
        this.onDocEvent(this, workspaceBackend, docEvent);
    }

    close(): void {
        this.isClosed = true;
        for (let backendFile of this.backendFiles) {
            backendFile.close();
        }
        this.backendFiles = [];
    }
}