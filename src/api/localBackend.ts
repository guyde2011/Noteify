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
import { Element, Link, Section, SectionId } from "./document";

export class LocalFilesBackend implements Backend {
	initialized: boolean = false;
	name: string = "Local Files";

	async init(): Promise<void> {
		this.initialized = true;
	}

	async open(
		workspaceUri: vscode.Uri
	): Promise<BackendResult<LocalFilesInstance>> {
		if (!(workspaceUri.scheme === "" || workspaceUri.scheme === "file")) {
			// TODO: Real error
			throw new Error("Workspace URI is invalid");
		}
		return BackendResult.success(
			new LocalFilesInstance(workspaceUri.fsPath)
		);
	}
}

type SectionInfo = {
	location: vscode.Location;
	contents: string;
	section: Section;
};

type FileUri = string;

type FileInfo = {
	sections: SectionId[];
};

export class LocalFilesInstance implements BackendInstance {
	// mandatory for backend workspaces
	workspaceUri: string;

	readonly features: BackendFeatures = {
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
	};

	properties = {
		viaName: "Noteify via local files",
	};

	// implementation of local files backend
	listenerSubscriptions: { dispose(): any }[] = [];

	fileInfos: Map<FileUri, FileInfo> = new Map();
	sectionInfos: Map<SectionId, SectionInfo> = new Map();

	constructor(workspaceUri: string) {
		this.workspaceUri = workspaceUri;
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
			const oldData = this.fileInfos.get(uri.toString());
			if (oldData !== undefined) {
				// Remove from file indexes...
			}
			const newSections = Section.fromBytes(uri, contents);

			const sectionIds = newSections.map((section) => this.addSection(section));
			// Add to file indexes...
			this.fileInfos.set(uri.toString(), { sections: sectionIds });
			// For now: just forcefully updating every file
			this.updateAllSourceFiles();
		});
	}

	onDeletedFileUri(uri: vscode.Uri): void {
		// TODO: Implement
		// const markdownFile = this.markdownFiles.get(uri.toString());
		// if (markdownFile !== undefined) {
		// 	// Remove from file indexes
		// 	this.markdownFiles.delete(uri.toString());
		// 	// For now: just forcefully updating every file
		// 	this.updateAllSourceFiles();
		// }
	}


	dispose(): void {
		for (let i = this.listenerSubscriptions.length - 1; i >= 0; i -= 1) {
			this.listenerSubscriptions[i].dispose();
		}
		this.listenerSubscriptions = [];
	}

	/**
	 * This is the "worse is better" implementation. I am not optimizing anything yet.
	 */
	updateAllSourceFiles(): void {
		// TODO: Implement
		// const allReferences = Array.from(this.markdownFiles.values())
		// 	.map((x) => x.linkReferences)
		// 	.reduce((a, b) => a.concat(b), []);
		// for (let fileBackend of this.sourceFiles.values()) {
		// 	fileBackend.incRefresh(allReferences);
		// }
	}

	getSection(id: SectionId): SectionInfo | undefined {
		return this.sectionInfos.get(id);
	}
}


namespace Section {
	export function fromBytes(uri: vscode.Uri, bytes: Uint8Array): Section[] {
		// look for any possible References
		let sections: Section[] = [];

		// Indexing should be fast and May contain false positives.
		let lineNumber = 0;
		let matchLineNumber = 0;
		let linkDestinationBytes: number[] = [];
		let documentationContentsBytes: number[] = [];
		let documentationContents: string = "";
		let sectionTitle: [string, number] = ["", 0];
		let sectionLinks: string[] = [];
		let sectionLine = 0;

		// -1: line does not match.
		// 0: new line. 1: it's a title's hashtags. 2: spaces after the hashtags. 3: a link's square brackets. 4: we expect the brackets. 5: a link's destination. 6: a link ended - ignore until end of line.
		// 7: newlines before documentation contents. 8: documentation contents. 9: a single newline in the documentation contents - may return to 8, or leave due to an extra newline or a #.
		let matchState = 0;

		for (let i = 0; i < bytes.length + 2; i++) {
			const b = i < bytes.length ? bytes[i] : "\n".charCodeAt(0);

			if (b === "\n".charCodeAt(0)) {
				if (matchState === 6 || matchState === 7) {
					matchState = 7;
				} else {
				lineNumber++;
				}
			} else if (
				(matchState === 0 || matchState === 1 || matchState === 9) &&
				b === "#".charCodeAt(0)
			) {
				if (matchState === 0) {
					// hashtags put us into title mode
					sectionLine = lineNumber;
					sectionTitle = ["", 1];
					matchState = 1;
				} else if (matchState === 1) {
					sectionTitle[1]++;
				} else if (matchState === 9) {
					// rather than two lines in a row, there is new line with a title interrupting us
					try {
						documentationContents = new TextDecoder("utf-8").decode(
							new Uint8Array(documentationContentsBytes)
						);
						const links: Link[] = sectionLinks.map((link) => ({ kind: "link", uri: link }));
						const elements: Element[] = [
							{
								kind: "title",
								content: sectionTitle[0],
								level: sectionTitle[1]
							}, {
							kind: "text",
							content: documentationContents
						}, ...links
					];

						sections.push(
							{ children: elements },
						);
						sectionLinks = [];
						sectionTitle = ["", 1];
					} catch (e) {}

					// also, a new match just started
					matchLineNumber = lineNumber;
					linkDestinationBytes = [];
					documentationContentsBytes = [];
					matchState = 1;
				}
			} else if (
				(matchState === 1 || matchState === 2) &&
				b === " ".charCodeAt(0)
			) {
				// spaces put us into padding mode
				matchState = 2;
			} else if (
				(matchState === 1 || matchState === 2) &&
				b === "[".charCodeAt(0)
			) {
				// [ puts us into square brackets mode
				matchState = 3;
			} else if (matchState === 3) {
				if (b === "]".charCodeAt(0)) {
					matchState = 4;
				}
			} else if (matchState === 4 && b === "(".charCodeAt(0)) {
				matchState = 5;
			} else if (matchState === 5) {
				if (b === ")".charCodeAt(0)) {
					matchState = 6;
					try {
						sectionLinks.push(new TextDecoder("utf-8").decode(
							new Uint8Array(linkDestinationBytes)
						));
					} catch (e) {
						matchState = -1;
					}
				} else {
					linkDestinationBytes.push(b);
				}
			} else if (matchState === 6) {
				// do nothing. we don't care until the next line.
			} else if (
				matchState === 7 ||
				matchState === 8 ||
				matchState === 9
			) {
				// documentation contents
				documentationContentsBytes.push(b);
				matchState = 8;
			} else {
				// unexpected character
				matchState = -1;
			}
		}

		return sections;
	}
}