import { Query, SyntaxNode, Tree } from "tree-sitter";
import Parser = require("tree-sitter");
import { LangApi, Language, Languages } from "./treeSitter";
import { Position, Range } from "vscode";
import { readFile } from "../utils";

export type SourceFile = string;

export type ParsedFile = {
    readonly filePath: SourceFile
    readonly contents: string
    readonly tree: Tree
    readonly api: LangApi
};

export class FileParser {
    private loadedFiles: Map<SourceFile, ParsedFile> = new Map();

    parseFile(file: SourceFile): Promise<ParsedFile> | undefined;
    parseFile(file: SourceFile, contents: string): ParsedFile | undefined;

    parseFile(file: SourceFile, contents?: string): Promise<ParsedFile> | ParsedFile | undefined {
        // Select a language
        const langApi = getApiForFile(file);
        if (!langApi) {
            return;
        }

        if (!contents) {
            return readFile(file).then((contents) => this.parseLoadedFile(file, contents, langApi));
        }

        return this.parseLoadedFile(file, contents, langApi);
    }

    private parseLoadedFile(file: SourceFile, contents: string, langApi: LangApi) {
        // If it is already cached with the same contents, just return it.
        if (this.loadedFiles.has(file)) {
            const loaded = this.loadedFiles.get(file)!;
            if (loaded.contents === contents) {
                return loaded;
            }
        }

        // Get a tree
        const tree = langApi.parse(contents);
        const parsedFile = {
            filePath: file,
            contents: contents,
            tree: tree,
            api: langApi
        };

        // Save in cache
        this.loadedFiles.set(file, parsedFile);

        return parsedFile;
    }
}


export function getApiForFile(file: SourceFile): LangApi | undefined {
    // TODO: Make this generic for different languages, and not hardcoded.
    for (const language of Languages.ALL_LANGUAGES) {
        for (const extension of language.fileExtensions) {
            if (file.endsWith(extension)) {
                return language;
            }
        }
    }
}

export function getNodeRange(node: SyntaxNode): Range {
    return new Range(
        new Position(
            node.startPosition.row,
            node.startPosition.column
        ),
        new Position(
            node.endPosition.row,
            node.endPosition.column
        )
    );
}

/**
 * Finds the smallest node that contains the given span within the source.
 * @param range A range within the ast
 * @param tree the AST
 * @returns the minimal node containing the range.
 */
export function findMinimalContainingNode(range: Range, tree: Tree): SyntaxNode {
    let curNode = tree.rootNode;
    while (true) {
        let foundChild = false;
        for (const child of curNode.children) {
            if (getNodeRange(child).contains(range)) {
                curNode = child;
                foundChild = true;
                break;
            }
        }
        if (!foundChild) {
            return curNode;
        }
    }
}

export function queriesCaptures(queries: Query[], node: SyntaxNode, options?: Parser.QueryOptions): Map<string, SyntaxNode[]> {
    let output = new Map();
    for (const query of queries) {
        const matches = query.matches(node, options);
        for (const match of matches) {
            for (const capture of match.captures) {
                if (!output.has(capture.name)) {
                    output.set(capture.name, []);
                }
                output.get(capture.name)!.push(capture.node);
            }
        }
    }
    return output;
}

export const fileParser: FileParser = new FileParser();