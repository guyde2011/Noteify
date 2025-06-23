import getAllBackends from "./allBackends";
import { BackendEvent } from "./events";
import { DocumentProcessor, Frontend } from "./frontend";
import { BackendStatus, Backend, BackendInstance } from "./interface";
import * as doc from "./document";
import * as vscode from "vscode";
import EventEmitter = require("node:events");

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

export enum LoadStatus {
	Ok = "ok",
	NoWorkspace = "no workspace",
}

type SessionBackend = {
	isOpen: boolean;
	backend?: BackendInstance;
};

type BackendId = number;

export class Session {
	backendInstances: SessionBackend[];
	allBackends: Backend[];

	listenerSubscriptions: { dispose(): any }[] = [];

	fileToBackend: Map<doc.File, BackendId> = new Map();

	/**
	 * The Session class holds state over all of the currently open backends, including information about each open file.
	 * It sits between the backend and frontend implementations.
	 */
	constructor(private frontend: Frontend) {
		this.allBackends = getAllBackends();

		// backends are all closed, initially
		this.backendInstances = this.allBackends.map(() => ({ isOpen: false }));

		this.frontend.sessionEmitter.on(
			"sectionEditRequest",
			this.applySectionEdit.bind(this)
		);

		// listen to stuff
		// this.listenToTextDocuments();
	}

	private applySectionEdit(
		sectionId: doc.SectionId,
		file: doc.File,
		section: doc.Section
	) {
		console.log("applySectionEdit", sectionId, file, section);
		const backendId = this.fileToBackend.get(file);
		if (backendId === undefined) {
			console.log("No backend!");
			return;
		}
		const sessionBackend = this.backendInstances[backendId];
		const backend = sessionBackend.backend;
		if (!backend || !sessionBackend.isOpen) {
			console.log("Backend is closed");
			return;
		}

		if (!backend.features.setSection) {
			console.log("Unsupported!");
			return;
		}

		backend.features.setSection(sectionId, file, section);
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

	onBackendEvent(
		index: BackendId,
		instance: BackendInstance,
		event: BackendEvent
	): void {
		switch (event.op) {
			case "open":
				{
					this.backendInstances[index].backend = instance;
				}
				break;
			case "send":
				{
					this.fileToBackend.set(event.doc.filename, index);
					this.frontend.onDocumentUpdated(event);
				}
				break;
			case "remove":
				{
					this.frontend.onDocumentRemoved(event);
				}
				break;
		}
	}

	/**
	 * load() may be called multiple times, and will always try loading every possible documentation backend.
	 */
	async load(): Promise<LoadStatus> {
		// We need the workspace to have a URI
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return LoadStatus.NoWorkspace;
		}

		// Some of the backends that weren't valid before might become valid now; for example, listening sockets that have been opened.
		const tasks = [];
		for (let i = 0; i < this.allBackends.length; i++) {
			const index = i;
			const backend = this.allBackends[i];

			// skip over already open backends
			if (this.backendInstances[i].isOpen) {
				continue;
			}

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
			this.backendInstances[i].isOpen = true;
			const eventHandler = (
				instance: BackendInstance,
				event: BackendEvent
			) => this.onBackendEvent(index, instance, event);
			const task = backend
				.open(eventHandler.bind(this))
				.then((result) => {
					if (result !== BackendStatus.Success) {
						console.log(
							`open for backend ${
								backend.name
							} failed with status code ${BackendStatus.toString(
								result
							)}`
						);
						this.backendInstances[i].isOpen = false;
						this.backendInstances[i].backend = undefined;
					} else {
						console.log(
							`Backend ${backend.name} opened successfully`
						);
					}
				});
			tasks.push(task);
		}

		await Promise.all(tasks);
		return LoadStatus.Ok;
	}

	dispose(): void {
		// close generic subscriptions
		for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
			this.listenerSubscriptions[i].dispose();
		}
		this.listenerSubscriptions = [];

		// close backend workspaces
		for (const backendInfo of this.backendInstances) {
			backendInfo.backend?.dispose();
			backendInfo.backend = undefined;
			backendInfo.isOpen = false;
		}

		this.backendInstances = [];

		// other
		this.allBackends = [];
	}
}
