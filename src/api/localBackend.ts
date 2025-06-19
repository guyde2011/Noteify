import * as vscode from "vscode";
import {
    Backend,
    BackendFeatures,
    BackendInstance,
    BackendResult,
    BackendStatus,
} from "./interface";

import { Tree } from "tree-sitter";

import { TextDecoder, TextEncoder } from "util";
import * as Doc from "./document";
import { BackendEvent } from "./events";
import { IdAllocator, parseDocument } from "./markdown";

export class LocalFilesBackend implements Backend {
    initialized: boolean = false;
    name: string = "Local Files";

    async init(): Promise<void> {
        this.initialized = true;
    }

    async open(listener: (inst: BackendInstance, ev: BackendEvent) => void): Promise<BackendStatus> {
        const instance = new LocalFilesInstance(listener);
        listener(instance, { op: "open" });
        return BackendStatus.Success;
    }
}

type FileUri = string;

type SectionIdInfo = {
    location: vscode.Location;
};

export class LocalFilesInstance implements BackendInstance {
    // mandatory for backend workspaces
    readonly features: BackendFeatures = {
        /*
        revealSection: async (sectionId) => {
            const sectionInfo = this.getSection(sectionId);

            if (!sectionInfo) {
                return BackendStatus.NotFound;
            }

            await vscode.window.showTextDocument(sectionInfo.location.uri, {
                selection: sectionInfo.location.range,
            });

            return BackendStatus.Success;
        },
        */
    };

    properties = {
        viaName: "Noteify via local files",
    };

    // implementation of local files backend
    listenerSubscriptions: { dispose(): any }[] = [];

    fileRoots: Map<FileUri, Doc.Root> = new Map();
    idAllocator: IdAllocator = new IdAllocator();

    constructor(public listener: (inst: BackendInstance, ev: BackendEvent) => void) {
        const fsWatcher = vscode.workspace.createFileSystemWatcher("**/**.md");
        this.listenerSubscriptions.push(fsWatcher);
        this.listenerSubscriptions.push(
            fsWatcher.onDidChange(this.onUpdatedFileUri.bind(this))
        );
        this.listenerSubscriptions.push(
            fsWatcher.onDidCreate(this.onUpdatedFileUri.bind(this))
        );
        this.listenerSubscriptions.push(
            fsWatcher.onDidDelete(this.onDeletedFileUri.bind(this))
        );
        // load initial files
        vscode.workspace.findFiles("**/**.md").then((initialUris) => {
            initialUris.forEach(this.onUpdatedFileUri.bind(this));
        });
    }

    onUpdatedFileUri(uri: vscode.Uri): void {
        vscode.workspace.fs.readFile(uri).then((contents) => {
            const parseResult = Section.parse(uri, contents, this.idAllocator);
			if (parseResult !== null) {
				const [doc, _] = parseResult;
				this.fileRoots.set(uri.toString(), doc);
				this.listener(this, { op: "send", doc });
			}
        });
    }

    onDeletedFileUri(uri: vscode.Uri): void {
		const uriString = uri.toString();
		const doc = this.fileRoots.get(uriString);
		if (doc !== undefined) {
			this.fileRoots.delete(uriString);
			this.listener(this, { op: "remove", filename: uri.toString() });
		}
    }

    dispose(): void {
        for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
            this.listenerSubscriptions[i].dispose();
        }
        this.listenerSubscriptions = [];
    }
}


namespace Section {
    export function parse(uri: vscode.Uri, bytes: Uint8Array, idAllocator: IdAllocator): [Doc.Root, Map<number, SectionIdInfo>] | null {
        const markdown = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        const document = parseDocument(uri.toString(), markdown, idAllocator);
		if (document === null) {
			return null;
		}
		// TODO: support section id mapping!!!!
		return [document, new Map()];
    }
}