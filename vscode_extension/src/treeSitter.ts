import { Tree, Query, SyntaxNode } from "tree-sitter";
import Parser = require("tree-sitter");
import * as Cpp from "tree-sitter-cpp";
import { readFile } from "./utils";
import { Position, Range } from "vscode";

export type SourceFile = string;

// TODO: Better abstraction for this type
export type Language = any;

export class QuerySet {
	public readonly queries: Query[];

	constructor(
		public readonly language: Language,
		public readonly stringQueries: string[]
	) {
		this.queries = stringQueries.map((query) => new Query(language, query));
	}

	checkCaptures(captures: Record<string, string>): Query[] {
		return this.stringQueries.map((query) => {
			const captureChecks = [];
			for (const capture in captures) {
				if (!query.includes(`@${capture}`)) {
					continue;
				}
				// TODO: Escape capture values (maybe unnecessary)
				captureChecks.push(`(#eq? @${capture} "${captures[capture]}")`);
			}
			return new Query(
				this.language,
				`(${query}\n${captureChecks.join("\n")})`
			);
		});
	}
}

export class LangApi {
	private readonly parser: Parser;
	public readonly symbolQueries: QuerySet;

	constructor(
		public readonly language: Language,
		public readonly fileExtensions: string[],
		symbolQueries: string[]
	) {
		this.parser = new Parser();
		this.parser.setLanguage(language);
		this.symbolQueries = new QuerySet(language, symbolQueries);
	}

	parse(contents: string): Tree {
		return this.parser.parse(contents);
	}
}

namespace SymbolQueries {
	export const CPP = [
		"(qualified_identifier scope: (_) @scope) @root",
		"(namespace_definition name: (namespace_identifier) @name @scope) @root",
		"(class_specifier name: (type_identifier) @name @scope) @root",
		"(struct_specifier name: (type_identifier) @name @scope) @root",
		"(union_specifier name: (type_identifier) @name @scope) @root",
		"(enum_specifier name: (type_identifier) @name @scope) @root",
		"(enumerator name: (_) @name) @root",
		"(qualified_identifier name: [(identifier) (type_identifier)] @name) @root",
		"(function_declarator declarator: [(identifier) (field_identifier)] @name) @root",
		"(field_declaration declarator: (field_identifier) @name) @root",
		"(declaration declarator: [(identifier) (field_identifier) (type_identifier)] @name) @root",
		"(init_declarator declarator: [(identifier) (field_identifier) (type_identifier)] @name) @root",
	];
}

namespace FileExtensions {
	export const CPP = [
		".cpp",
		".cc",
		".hh",
		".c++",
		".cxx",
		".hxx",
		".hpp",
		".h++",
		".h",
	];
}

export namespace Languages {
	export const ALL_LANGUAGES: LangApi[] = [];

	function createApi(
		language: Language,
		fileExtensions: string[],
		symbolQueries: string[]
	): LangApi {
		const api = new LangApi(language, fileExtensions, symbolQueries);
		ALL_LANGUAGES.push(api);
		return api;
	}

	export const CPP = createApi(
		Cpp as Language,
		FileExtensions.CPP,
		SymbolQueries.CPP
	);
}

export interface ParsedFile {
	readonly filePath: SourceFile;
	readonly contents: string;
	readonly tree: Tree;
	readonly api: LangApi;
}

export class FileParser {
	private loadedFiles = new Map<SourceFile, ParsedFile>();

	parseFile(file: SourceFile): Promise<ParsedFile> | undefined;
	parseFile(file: SourceFile, contents: string): ParsedFile | undefined;

	parseFile(
		file: SourceFile,
		contents?: string
	): Promise<ParsedFile> | ParsedFile | undefined {
		// Select a language
		const langApi = getApiForFile(file);
		if (!langApi) {
			return;
		}

		if (!contents) {
			return readFile(file).then((contents) =>
				this.parseLoadedFile(file, contents, langApi)
			);
		}

		return this.parseLoadedFile(file, contents, langApi);
	}

	private parseLoadedFile(
		file: SourceFile,
		contents: string,
		langApi: LangApi
	) {
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
			api: langApi,
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
		new Position(node.startPosition.row, node.startPosition.column),
		new Position(node.endPosition.row, node.endPosition.column)
	);
}

/**
 * Finds the smallest node that contains the given span within the source.
 * @param range A range within the ast
 * @param tree the AST
 * @returns the minimal node containing the range.
 */
export function findMinimalContainingNode(
	range: Range,
	tree: Tree
): SyntaxNode {
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

export function queriesCaptures(
	queries: Query[],
	node: SyntaxNode,
	options?: Parser.QueryOptions
): Map<string, SyntaxNode[]> {
	const output = new Map<string, SyntaxNode[]>();
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
