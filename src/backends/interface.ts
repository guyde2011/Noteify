import * as vscode from 'vscode';

export enum BackendStatus {
    Success = 0,
    ConnectionClosed = 1,
    Unsupported = 2,
    NotFound = 3,
}

export interface DocumentationBackend {
    /**
     * init says whether the backend is relevant in this universe.
     * It is also allowed to initialize some very rudamentary empty state, like a database of open workspaces. This state must not be complicated enough to require a "dispose".
     * 
     * init is intended to complete quickly. It should be a very O(1) operation.
     * 
     * Good usage examples of it include:
     * - Look for binaries relevant to this backend
     * - Check whether this backend's socket is open
     * 
     * @returns a boolean of whether the backend exists and can be opened.
     */
    init(): Promise<boolean>;

    /**
     * Opening a documentation backend:
     *  - Returns "NotFound" if the backend does not exist.
     *  - Is encouraged to build an index of docmentation objects if necessary.
     * @param workspaceUri By default, should come from "workspaceFile", and may be stored as an identifier for this worksapce within the backend.
     * It could also be `noteify://user_defined_name`, to make the documentation portable between users and machines.
     */
    open(workspaceUri: string): Promise<BackendStatus | DocumentationBackendWorkspace>;
}

export interface DocumentationBackendWorkspace {
    /**
     * A documentation backend workspace is an instance of the backend, which may have outgoing connections and may be specific to the workspace.
     * Nonetheless, it is possible for several workspace to share a connection in the backend, if a reference count or other tracking mechanism is maintained.
     */
    properties: {
        /**
         * Each of these feature flags defines whether a functionality exists in this backend. If it doesn't exist, don't show it to the user.
         * Nonetheless, the backend is required to implement and return an "Unsupported" status for unsupported features.
         */
        featureFlags: {
            editDoc: boolean;
            createDoc: boolean;
            jumpTo: boolean;
        }
    };

    listen(): AsyncIterator<DocEvent>;

    // When a request returns, it means that it was received by the backend.
    // As a design decision, the corresponding event for a similar change initiated by the backend is not sent, under the assumption that the UI interaction is logically synchronous and responsible for ensuring successful actuation.
    requestJumpTo(docId: number): Promise<BackendStatus>;
    requestEdit(docId: number, markdown: string): Promise<BackendStatus>;
    /**
     * @returns either a backend status, or the document ID wrapped under a small object because BackendStatus is a number too.
     */
    requestCreate(docId: number, markdown: string): Promise<BackendStatus | {"docId": number}>;

    /**
     * Closes any outgoing connection to the backend. It must complete synchronously, because the workspace may be reopened immediately after calling dispose().
     */
    dispose(): void;
}

/**
 * A stream of documentation events is the main way for the documentation backend to send its updates as well as the initial contents to the frontend.
 * I am considering adding a "show" event, which would be sent after the initial stream of DocAdd event all got received. But I'm not sure that it's necessary yet.
 */
export type DocEvent = DocAdd | DocDelete | DocChange;
export enum DocEventType {
    Add = "add",
    Delete = "delete",
    Change = "change",
}

export interface DocAdd {
    type: DocEventType.Add;
    /**
     * docId is a unique incrementing ID representing the object within a documentation backend workspace.
     */
    docId: number;
    /**
     * If the symbol can't be resolved, this should be a user visible error, showing the problematic documentation object.
     */
    lineOrSymbol: number | string;
    /**
     * Markdown is the only interface in which the backend can give documentation contents to the frontend.
     */
    markdown: string;
}

/**
 * This event is only to be sent when a deletion is initiated by the backend, not when it was requested by the frontend.
 */
export interface DocDelete {
    type: DocEventType.Delete;
    docId: number;
}

/**
 * This event is only to be sent when a change is initiated by the backend, not when the edit was requested by the frontend.
 */
export interface DocChange {
    type: DocEventType.Change;
    docId: number;
    /**
     * The new markdown contents replace the old ones.
     */
    markdown: string;
}
