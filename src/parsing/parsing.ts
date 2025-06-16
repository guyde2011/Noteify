import { Query, SyntaxNode, Tree } from "tree-sitter";
import Parser = require("tree-sitter");
import { LangApi, Language, Languages } from "./language";
import { Position, Range } from "vscode";

export type SourceFile = string;

export class ParsedFile {
    constructor(
        public readonly filePath: SourceFile,
        public readonly contents: string,
        public readonly tree: Tree,
        public readonly api: LangApi
    ) { }
};

export class FileParser {
    private loadedFiles: Map<SourceFile, ParsedFile> = new Map();

    parseFile(file: SourceFile, contents: string): ParsedFile | undefined {
        // If it is already cached with the same contents, just return it.
        if (this.loadedFiles.has(file)) {
            const loaded = this.loadedFiles.get(file)!;
            if (loaded.contents === contents) {
                return loaded;
            }
        }

        // Select a language
        const langApi = getApiForFile(file);
        if (!langApi) {
            return;
        }

        // Get a tree
        const tree = langApi.parse(contents);
        const parsedFile = new ParsedFile(file, contents, tree, langApi);

        // Save in cache
        this.loadedFiles.set(file, parsedFile);

        return parsedFile;
    }
}

const CPP_SUFFIXES = [".cpp", ".cc", ".hh", ".c++", ".cxx", ".hxx", ".hpp", ".h++", ".h"];

export function getApiForFile(file: SourceFile): LangApi | undefined {
    // TODO: Make this generic for different languages, and not hardcoded.
    for (const cppSuffix of CPP_SUFFIXES) {
        if (file.endsWith(cppSuffix)) {
            return Languages.CPP;
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