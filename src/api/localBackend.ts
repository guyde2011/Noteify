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
import { IdAllocator, parseDocument, SectionIdInfo } from "./markdown";
import * as Md from "mdast";

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

export class LocalFilesInstance implements BackendInstance {
    // mandatory for backend workspaces
    readonly features: BackendFeatures = {
        revealSection: async (sectionId) => {
            const sectionInfo = this.globalSectionIdMap.get(sectionId);

            if (sectionInfo === undefined || sectionInfo.location === null) {
                return BackendStatus.NotFound;
            }

            await vscode.window.showTextDocument(sectionInfo.location.uri, {
                selection: sectionInfo.location.range,
            });

            return BackendStatus.Success;
        },
    };

    properties = {
        viaName: "Noteify via local files",
    };

    // implementation of local files backend
    listenerSubscriptions: { dispose(): any }[] = [];

    fileRoots: Map<FileUri, [Doc.Root, Doc.SectionId[]]> = new Map();
    globalSectionIdMap: Map<Doc.SectionId, SectionIdInfo> = new Map();
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
                const [doc, sectionIdMap] = parseResult;

                const sectionIdList = Array.from(sectionIdMap.keys());
                this.fileRoots.set(uri.toString(), [doc, sectionIdList]);
                sectionIdMap.forEach((v, k) => this.globalSectionIdMap.set(k, v));

                this.listener(this, { op: "send", doc });
            }
        });
    }

    onDeletedFileUri(uri: vscode.Uri): void {
        const uriString = uri.toString();
        const entry = this.fileRoots.get(uriString);
        if (entry !== undefined) {
            const [_doc, sectionIdList] = entry;
            this.fileRoots.delete(uriString);
            sectionIdList.forEach(sectionId => this.globalSectionIdMap.delete(sectionId));
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
    export function parse(uri: vscode.Uri, bytes: Uint8Array, idAllocator: IdAllocator): [Doc.Root, Map<Doc.SectionId, SectionIdInfo>] | null {
        const markdown = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        return parseDocument(uri.toString(), markdown, idAllocator);
    }
}