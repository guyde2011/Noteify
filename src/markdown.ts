import { TextDecoder } from "util";
import { Location, Position, Range, Uri } from "vscode";
import * as vscode from "vscode";
import { readFile, writeFile } from "./utils";

export class MarkdownSection {
    constructor(public title: string, public hashCount: number, public lines: string[]) { }

    getContent(): string {
        let startIndex = 0, endIndex = this.lines.length;
        while (startIndex < endIndex && this.lines[startIndex].trim().length === 0) { startIndex++; }
        while (endIndex > startIndex && this.lines[endIndex -1 ].trim().length === 0) { endIndex--; }
        return this.lines.slice(startIndex, endIndex).join("\n");
    }
}

function findSections(content: string): MarkdownSection[] {
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
        sections.push(new MarkdownSection(title, hashCount, sectionLines));
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

    async indexFile(uri: Uri) {
        return readFile(uri).then((content) => {
            const sections = findSections(content).map((section, index) => { return { section: section, sectionIndex: index }; });
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

    saveContents() {
        for (const [filePath, sections] of this.fileSections) {
            const sectionStrings = sections.map(
                (section) => {
                    const titleHashes = "#".repeat(section.section.hashCount);
                    return `${titleHashes} ${section.section.title}\n${section.section.lines}`;
                }
            );
            writeFile(filePath, sectionStrings.join("\n"));
        }
    }

    getSections(docFile: Uri): DocSection[] | undefined {
        return this.fileSections.get(docFile.fsPath);
    }

    getFiles(): MapIterator<string> {
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
        originSections.push(docSection);
        return docSection;
    }
}


export var docManager = new DocsManager();