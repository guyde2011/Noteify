import * as vscode from "vscode";
import {
	Backend,
	BackendFeatures,
	BackendInstance,
	BackendStatus,
} from "./interface";

import { TextDecoder } from "util";
import * as doc from "./document";
import { BackendEvent } from "./events";
import { IdAllocator, parseDocument, SerialIdAllocator } from "./markdown";
import { transformDoc } from "../documentTree";
import { renderMarkdown } from "../editorComment";
import { LineMapper, objectFromFields, readFile, writeFile } from "../utils";

export class LocalFilesBackend implements Backend {
	initialized: boolean = false;
	name: string = "Local Files";

	async init(): Promise<void> {
		this.initialized = true;
	}

	async open(
		listener: (inst: BackendInstance, ev: BackendEvent) => void
	): Promise<BackendStatus> {
		const instance = new LocalFilesInstance(listener);
		listener(instance, { op: "open" });
		return BackendStatus.Success;
	}
}

type FileUri = string;

type FileData = {
	root: doc.Root;
	ranges: Map<doc.SectionId, vscode.Range>;
	lineMapper: LineMapper;
};

export class LocalFilesInstance implements BackendInstance {
	// implementation of local files backend
	listenerSubscriptions: { dispose(): any }[] = [];

	files: Map<FileUri, FileData> = new Map();
	idAllocator: IdAllocator = new SerialIdAllocator();

	constructor(
		public listener: (inst: BackendInstance, ev: BackendEvent) => void
	) {
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
		vscode.workspace.findFiles("**/*.md").then((initialUris) => {
			initialUris.forEach(this.onUpdatedFileUri.bind(this));
		});
	}

	onUpdatedFileUri(uri: vscode.Uri): void {
		vscode.workspace.fs.readFile(uri).then((contents) => {
			const parseResult = Section.parse(uri, contents, this.idAllocator);
			if (!parseResult) {
				return;
			}
			const [doc, ranges, stringContents] = parseResult;
			this.files.set(uri.toString(), {
				root: doc,
				ranges: ranges,
				lineMapper: new LineMapper(stringContents),
			});
			this.listener(this, { op: "send", doc });
		});
	}

	onDeletedFileUri(uri: vscode.Uri): void {
		const uriString = uri.toString();
		const doc = this.files.get(uriString);
		if (doc !== undefined) {
			this.files.delete(uriString);
			this.listener(this, { op: "remove", filename: uri.toString() });
		}
	}

	dispose(): void {
		for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
			this.listenerSubscriptions[i].dispose();
		}
		this.listenerSubscriptions = [];
	}

	readonly features: BackendFeatures = {
		setSection: async (
			sectionId: doc.SectionId,
			fileName: doc.File,
			section: doc.Section
		) => {
			const file = this.files.get(fileName);
			if (!file) {
				return BackendStatus.NotFound;
			}
			const fileUri = vscode.Uri.parse(fileName);
			const range = file.ranges.get(section.id);
			if (!range) {
				return BackendStatus.NotFound;
			}
			const start = file.lineMapper.toCharPosition(range.start);
			const end = file.lineMapper.toCharPosition(range.end);
			if (!start || !end) {
				// TODO: Better error code here
				return BackendStatus.NotFound;
			}

			const contents = await readFile(fileUri);
			const startPart = contents.substring(0, start);
			const endPart = contents.substring(end);
			const parts = [startPart, renderMarkdown(section), endPart];
			await writeFile(fileUri, parts.join(""));
			return BackendStatus.Success;
		},
	};

	properties = {
		viaName: "Noteify via local files",
	};
}

namespace Section {
	export function parse(
		uri: vscode.Uri,
		bytes: Uint8Array,
		idAllocator: IdAllocator
	): [doc.Root, Map<doc.SectionId, vscode.Range>, string] | undefined {
		const markdown = new TextDecoder("utf-8", { fatal: false }).decode(
			bytes
		);
		const parsed = parseDocument(uri.toString(), markdown, idAllocator);
		if (!parsed) {
			return;
		}
		return [...parsed, markdown];
	}
}
