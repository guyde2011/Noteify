import { Tree, Query } from "tree-sitter";
import Parser = require("tree-sitter");
import * as Cpp from "tree-sitter-cpp";

// TODO: Better abstraction for this type
export type Language = any;

export class QuerySet {
    public readonly queries: Query[];

    constructor(public readonly language: Language, public readonly stringQueries: string[]) {
        this.queries = stringQueries.map((query) => new Query(language, query));
    }

    checkCaptures(captures: { [key: string]: string }): Query[] {
        return this.stringQueries.map((query) => {
            let captureChecks = [];
            for (const capture in captures) {
                if (!query.includes(`@${capture}`)) {
                    continue;
                }
                // TODO: Escape capture values (maybe unnecessary)
                captureChecks.push(`(#eq? @${capture} "${captures[capture]}")`);
            }
            return new Query(this.language, `(${query}\n${captureChecks.join("\n")})`);
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
        "(init_declarator declarator: [(identifier) (field_identifier) (type_identifier)] @name) @root"
    ];
}

namespace FileExtensions {
    export const CPP = [".cpp", ".cc", ".hh", ".c++", ".cxx", ".hxx", ".hpp", ".h++", ".h"];
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


    export const CPP = createApi(Cpp as Language, FileExtensions.CPP, SymbolQueries.CPP);
}