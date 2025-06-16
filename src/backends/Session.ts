import getAllBackends from './allBackends';
import { BackendStatusToString, DocumentationBackend, DocumentationBackendWorkspace } from './interface';
import * as vscode from "vscode";

export default class Session {
    openBackendWorkspaces: Array<DocumentationBackendWorkspace>;
    backendsWorkspacesOpen: Array<boolean>;
    allBackends: Array<DocumentationBackend>;

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
    }
}