import getAllBackends from "./allBackends";
import { BackendEvent } from "./events";
import { DocumentProcessor } from "./frontend";
import {
	BackendStatus,
	Backend,
	BackendInstance,
} from "./interface";
import * as vscode from "vscode";

/**
 * Interface the frontend provides to the session to be notified about new documentation objects.
 */
/*
export interface SessionFrontend<SessionFrontendDoc> {
	addDoc(
		textDocument: vscode.TextDocument,
		requestHandle: SessionFrontendRequestHandle,
		lineOrSymbol: number | string,
		markdown: string
	): SessionFrontendDoc;
	delDoc(doc: SessionFrontendDoc): void;
	changeDoc(doc: SessionFrontendDoc, markdown: string): void;
}
*/

/**
 * proxy object giving access to DocumentationBackendFile's request methods for a specific doc, excluding access to create.
 */
/*
export class SessionFrontendRequestHandle {
	constructor(
		public backendFile: DocumentationBackendFile,
		public docId: number
	) {}
	get backendProperties() {
		return this.backendFile.parentWorkspace.properties;
	}
	jumpTo(): Promise<BackendStatus> {
		return this.backendFile.requestJumpTo(this.docId);
	}
	edit(markdown: string): Promise<BackendStatus> {
		return this.backendFile.requestEdit(this.docId, markdown);
	}
	delete(): Promise<BackendStatus> {
		return this.backendFile.requestDelete(this.docId);
	}
}
*/

export class Session {
	openBackendInstances: BackendInstance[];
	backendInstancesOpen: boolean[];
	allBackends: Backend[];
	frontend: DocumentProcessor;

	listenerSubscriptions: { dispose(): any }[];

	/**
	 * The Session class holds state over all of the currently open backends, including information about each open file.
	 * It sits between the backend and frontend implementations.
	 */
	constructor(frontend: DocumentProcessor) {
		this.openBackendInstances = [];
		// backends are all closed, initially
		this.backendInstancesOpen = [];
		this.allBackends = getAllBackends();
		for (let i = 0; i < this.allBackends.length; i++)
			this.backendInstancesOpen.push(false);
		this.frontend = frontend;
		this.listenerSubscriptions = [];

		// listen to stuff
		// this.listenToTextDocuments();
	}

	/**
	 * Called once, during initialization. Looks at all open textDocuments.
	 */
	/*
	listenToTextDocuments(): void {
		// Initialize openFileUris with all of the current text docuemnt URIs.
		// This does not need to notify any backend because none exist yet.
		for (let doc of vscode.workspace.textDocuments) {
			this.fileBackends.set(
				doc,
				new SessionFile(doc, this.onDocEvent.bind(this))
			);
		}

		// new documents that are being opened
		let ev = vscode.workspace.onDidOpenTextDocument((textDocument) => {
			// currently, no backends
			const sessionFile = new SessionFile(
				textDocument,
				this.onDocEvent.bind(this)
			);
			this.fileBackends.set(textDocument, sessionFile);

			// asynchronously add every existing backend to this file
			for (let i = 0; i < this.openBackendWorkspaces.length; i++) {
				sessionFile.openFor(this.openBackendWorkspaces[i], i);
			}
		});
		this.listenerSubscriptions.push(ev);
		// documents that have been closed
		ev = vscode.workspace.onDidCloseTextDocument((textDocument) => {
			const sessionFile = this.fileBackends.get(textDocument);
			if (sessionFile !== undefined) {
				sessionFile.close();
				this.fileBackends.delete(textDocument);
			}
		});
		this.listenerSubscriptions.push(ev);
	}
	*/

	/*
	onDocEvent(
		textDocument: vscode.TextDocument,
		backendIndex: number,
		backendFile: DocumentationBackendFile,
		docEvent: DocEvent
	): void {
		console.log(`Got event: ${docEvent.type} for ${textDocument.uri}`);

		switch (docEvent.type) {
			case DocEventType.Add: {
				const docId = docEvent.docId;
				const key = `${backendIndex}:${textDocument.uri.toString()}:${docId}`;
				const newComment = this.frontend.addDoc(
					textDocument,
					new SessionFrontendRequestHandle(backendFile, docId),
					docEvent.lineOrSymbol,
					docEvent.markdown
				);
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
	*/

	onBackendEvent(instance: BackendInstance, event: BackendEvent): void {
		switch (event.op) {
			case "open": {
				this.openBackendInstances.push(instance);
			} break;
			case "send": {
				this.frontend.onDocumentUpdated(event);
			} break;
			case "remove": {
				this.frontend.onDocumentRemoved(event);
			} break;
		}
	}

	/**
	 * load() may be called multiple times, and will always try loading every possible documentation backend.
	 */
	async load(): Promise<"no workspace" | "ok"> {
		// We need the workspace to have a URI
		const workspaceRawUri = vscode.workspace.workspaceFile;
		if (workspaceRawUri === undefined) return "no workspace";

		// Some of the backends that weren't valid before might become valid now; for example, listening sockets that have been opened.
		let tasks = [];
		for (let i = 0; i < this.allBackends.length; i++) {
			const backend = this.allBackends[i];

			// skip over already open backends
			if (this.backendInstancesOpen[i]) continue;

			// try to initialize uninitialized backends
			if (!backend.initialized) {
				console.log(`trying to initialize backend ${backend.name}`);
				await backend.init();
				if (!backend.initialized) {
					continue;
				}
				console.log(`initialized backend ${backend.name}`);
			}

			// open the backend
			this.backendInstancesOpen[i] = true;
			const task = backend.open(this.onBackendEvent.bind(this)).then(result => {
				if (result !== BackendStatus.Success) {
					console.log(`open for backend ${backend.name} failed with status code ${BackendStatus.toString(result)}`);
					this.backendInstancesOpen[i] = false;
				} else {
					console.log(`Backend ${backend.name} opened successfully`);
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

		// close backend workspaces
		for (let instance of this.openBackendInstances) {
			instance.dispose();
		}
		this.openBackendInstances = [];

		// other
		this.allBackends = [];
		this.backendInstancesOpen = [];
	}
}