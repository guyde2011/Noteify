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

/**
 * a Session is a proxy object providing access to a number of Backends. Each Backend provides:
 * - a stream of standardized events (BackendEvent)
 * - a BackendInstance object, which must be disposed of, containing:
 *   - Metadata about the backend
 *   - Implementation of (optionally implementable) request methods, such as:
 *     - Reveal (jump to a place in the documentation)
 *     - Edit (request a change to happen in the contents)
 *     - et cetera.
 *   - Nonetheless, the only authority for external documentation's state is the event stream. Request methods are always best effort.
 */
export class Session {
	allBackends: Backend[];
	/**
	 * mappings between Backend index in allBackends to information about the instance.
	 * null: not open at all
	 * true: currently being opened
	 * { instance, openFiles }: currently active
	 */
	backendInstances: ({ instance: BackendInstance, openFiles: Set<string> } | true | null)[];
	frontend: DocumentProcessor;


	constructor(frontend: DocumentProcessor) {
		this.allBackends = getAllBackends();
        this.backendInstances = Array(this.allBackends.length).fill(null);
		this.frontend = frontend;
	}

	onBackendEvent(backendIndex: number, instance: BackendInstance, event: BackendEvent): void {
		if (event.op === "open") {
			this.backendInstances[backendIndex] = { instance, openFiles: new Set() };
			return;
		}

		const instanceInfo = this.backendInstances[backendIndex];
		if (instanceInfo === null || instanceInfo === true) {
			console.assert(instanceInfo !== null && instanceInfo !== true);
			return;
		}

		const { openFiles } = instanceInfo;

		switch (event.op) {
			case "close": {
				console.log(`Backend closed with status ${BackendStatus.toString(event.status)}`);

				// show client message
				vscode.window.showInformationMessage(`Connection closed to backend ${this.allBackends[backendIndex].name}: ${BackendStatus.toString(event.status)}`);

				// send matching "remove" events for every document from this backend
				openFiles.forEach(filename => this.frontend.onDocumentRemoved({ op: "remove", filename }));
				openFiles.clear();

				// done
				this.backendInstances[backendIndex] = null;
			} break;
			case "send": {
				this.frontend.onDocumentUpdated(event);
				openFiles.add(event.doc.filename);
			} break;
			case "remove": {
				this.frontend.onDocumentRemoved(event);
				openFiles.delete(event.filename);
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
			if (this.backendInstances[i] !== null) continue;

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
			this.backendInstances[i] = true;
			const task = backend.open(this.onBackendEvent.bind(this, i)).then(result => {
				if (result !== BackendStatus.Success) {
					console.log(`open for backend ${backend.name} failed with status code ${BackendStatus.toString(result)}`);
					this.backendInstances[i] = null;
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
		// close backend workspaces
		for (const maybeInstance of this.backendInstances) {
			if (maybeInstance !== null && maybeInstance !== true) {
				maybeInstance.instance.dispose();
			}
		}
		this.backendInstances = [];

		// other
		this.allBackends = [];
	}
}