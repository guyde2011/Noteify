import { Uri } from "vscode";
import * as vscode from "vscode";
import { readFile, writeFile } from "./utils";

export class MarkdownSection {
    public lines: string[];
    public spacing: string[];
    constructor(
        public title: string,
        public hashCount: number,
        rawLines: string[],
        public readonly parent: DocsManager
    ) {
        let startIndex = 0;
        while (startIndex < rawLines.length && rawLines[startIndex].trim().length === 0) { startIndex++; }
        this.spacing = rawLines.slice(0, startIndex);
        this.lines = rawLines.slice(startIndex);
    }

    get content(): string {
        return this.lines.join("\n");
    }

    set content(content: string) {
        this.lines = content.split("\n");
    }

    get fullContent(): string {
        const hashes = "#".repeat(this.hashCount);
        return `${hashes}${this.title}\n${this.spacing.join("\n")}\n${this.content}`;
    }
}

export type DocSection = {
    section: MarkdownSection
    sectionIndex: number
};

// TODO: Correctly interact with title # count
export class DocsManager {
    private fileSections: Map<string, DocSection[]>;

    constructor() {
        this.fileSections = new Map<string, DocSection[]>();
    }

    private findSections(content: string): MarkdownSection[] {
        let sections: MarkdownSection[] = [];
        let sectionLines: string[] = [];
        let sectionTitleLine: string | null = null;
        const lines = content.split("\n");

        const pushSection = () => {
            if (sectionTitleLine === null) {
                return;
            }
            const hashCount = sectionTitleLine.search(RegExp("[^#]"));
            const title = sectionTitleLine.substring(hashCount);
            sections.push(new MarkdownSection(title, hashCount, sectionLines, this));
        };
        lines.forEach((line) => {
            // If this is a non-title line
            if (!line.trimStart().startsWith("#")) {
                if (sectionTitleLine !== null) {
                    sectionLines.push(line);
                }
                return;
            }

            pushSection();

            sectionLines = [];
            sectionTitleLine = line.trimStart();
        });

        pushSection();

        return sections;
    }


    async indexFile(uri: Uri): Promise<void> {
        return readFile(uri).then((content) => {
            const sections = this.findSections(content).map(
                (section, index) => {
                    return { section: section, sectionIndex: index };
                }
            );
            this.fileSections.set(uri.fsPath, sections);
        });
    }

    modifySection(uri: Uri, index: number, newContent: string[]) {
        if ((!this.fileSections.has(uri.fsPath)) || this.fileSections.get(uri.fsPath)!.length < index) {
            // TODO: error
            console.log("Failed to modify non existent section");
            return;
        }

        this.fileSections.get(uri.fsPath)![index].section.lines = newContent;
    }

    async saveFileContent(filePath: Uri): Promise<void> {
        if (!this.fileSections.has(filePath.fsPath)) {
            return;
        }
        const sections = this.fileSections.get(filePath.fsPath)!;
        const sectionStrings = sections.map(
            (section) => section.section.fullContent
        );
        return writeFile(filePath, sectionStrings.join(""));
    }

    async saveContents(): Promise<void> {
        for (const [filePath, _] of this.fileSections) {
            await this.saveFileContent(vscode.Uri.file(filePath));
        }
    }

    getSections(docFile: Uri): DocSection[] | undefined {
        return this.fileSections.get(docFile.fsPath);
    }

    getFiles(): Iterable<string> {
        return this.fileSections.keys();
    }

    appendSection(originUri: Uri, section: MarkdownSection): DocSection {
        if (!this.fileSections.has(originUri.fsPath)) {
            // TODO: should we create the file here, maybe index it (if it exists) ???
            this.fileSections.set(originUri.fsPath, []);
        }
        const originSections = this.fileSections.get(originUri.fsPath)!;
        const docSection = {
            section: section,
            sectionIndex: originSections.length
        };

        if (originSections.length > 0) {
            const lastSection = originSections[originSections.length - 1].section;
            if (lastSection.lines.length > 0 && lastSection.lines[lastSection.lines.length - 1].trim() !== "") {
                // Per markdown standards, put an additional empty line between sections
                lastSection.lines.push("");
            }
            // Start a new section via a new line if there's a section before
            lastSection.lines.push("");
        }
        originSections.push(docSection);
        return docSection;
    }
}


export var docManager = new DocsManager();