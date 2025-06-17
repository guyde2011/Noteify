import * as vscode from "vscode";
import { LinkedDoc, SymbolDoc } from "./symbolDoc";
import { lspProvider, LSPSymbolProvider, SymbolData, tsProvider, TSSymbolProvider } from "./parsing/symbol";
import { fileParser } from "./parsing/parsing";

export var symbolCommentController: vscode.CommentController | null = null;
var lastCommentId = 0;

// TODO: Move me after supporting more comment types.
export abstract class ResearchComment implements vscode.Comment {
    constructor(
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public contextValue?: string | undefined,
        public parents: vscode.CommentThread[] = [],
    ) {
        this.id = lastCommentId++;
    };

    public readonly id: number;

    abstract get body(): string | vscode.MarkdownString;
    abstract isEditable(): boolean;

    abstract onUserEdit(): void;
}

export class SymbolComment extends ResearchComment {
    constructor(
        public docs: SymbolDoc,
        mode: vscode.CommentMode,
        author: vscode.CommentAuthorInformation,
        parents: vscode.CommentThread[] = [],
        contextValue?: string | undefined,
    ) {
        super(mode, author, contextValue, parents);
    }

    get body(): vscode.MarkdownString {
        return new vscode.MarkdownString(this.docs.docs.section.content);
    }

    set body(content: string | vscode.MarkdownString) {
        if (content instanceof vscode.MarkdownString) {
            content = content.value;
        }
        this.docs.docs.section.content = content;
    }

    get label(): string {
        const relPath = vscode.workspace.asRelativePath(this.docs.uri.fsPath);
        return `(From \`${relPath}\`)`;
    }

    isEditable(): boolean {
        return true;
    }

    onUserEdit(): void {
        this.docs.sendUpdate();
        this.docs.docs.section.parent.saveFileContent(this.docs.uri);
        for (const parent of this.parents) {
            // Refresh the parent's comments
            parent.comments = parent.comments;
        }
    }
}

export abstract class CommentsManager<D extends LinkedDoc, C extends ResearchComment> {
    private commentsById: Map<number, [D, C]>;

    constructor() {
        this.commentsById = new Map();
    }

    protected abstract createComment(docs: D): C;
    protected abstract createCommentThread(docs: D, comment: C, location: vscode.Location): vscode.CommentThread;

    insertComment(docs: D, location: vscode.Location): C {
        if (!this.commentsById.has(docs.innerId)) {
            this.commentsById.set(docs.innerId, [docs, this.createComment(docs)]);
        }
        const [_, comment] = this.commentsById.get(docs.innerId)!;
        const thread = this.createCommentThread(docs, comment, location);
        comment.parents.push(thread);
        return comment;
    }
}

export class SymbolCommentManager extends CommentsManager<SymbolDoc, SymbolComment> {
    protected createComment(docs: SymbolDoc): SymbolComment {
        return new SymbolComment(
            docs,
            vscode.CommentMode.Preview,
            { name: "Researcher" }
        );
    }

    protected createCommentThread(_: SymbolDoc, comment: SymbolComment, location: vscode.Location): vscode.CommentThread {
        const thread = symbolCommentController!.createCommentThread(location.uri, location.range, [comment]);
        thread.canReply = false;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        return thread;
    }
}

export var symbolCommentManager = new SymbolCommentManager();

export function initComments() {
    if (symbolCommentController === null) {
        symbolCommentController = vscode.comments.createCommentController('noteify-comments', "Research Docs");
    }
}

export async function showSymbolDocs(docs: SymbolDoc[]) {
    for (const doc of docs) {
        const searchQuery = { name: doc.symbol };
        const lspSymbols = await lspProvider.searchSymbol(searchQuery);
        const tsSymbols = await tsProvider.searchSymbol(searchQuery);
        // We sort all symbols, and then try to add each of them, unless they have an intersection with an existing one.
        const allSymbols = Array.from(lspSymbols);
        allSymbols.concat(tsSymbols);

        const compareSymbols = (lhs: SymbolData, rhs: SymbolData) => {
            const uriComp = lhs.uri.fsPath.localeCompare(rhs.uri.fsPath);
            if (uriComp !== 0) { return uriComp; }
            const lineComp = lhs.range.start.line - rhs.range.start.line;
            if (lineComp !== 0) { return lineComp; }
            return lhs.range.start.character - rhs.range.start.character;
        };

        allSymbols.sort(compareSymbols);

        const symbols = [];
        for (const symbol of allSymbols) {
            let isUnique = true;
            for (let i = symbols.length - 1; i >= 0; i--) {
                const existingSymbol = symbols[i];
                if (symbol.uri !== existingSymbol.uri || symbol.range.start.line > existingSymbol.range.end.line) {
                    // We assume here symbols are a single line. thus endLine == startLine for symbols
                    break;
                }
                if (symbol.range.intersection(existingSymbol.range)) {
                    // There's an intersection
                    isUnique = false;
                    break;
                }
            }
            if (isUnique) {
                symbols.push(symbol);
            }
        }

        for (const symbol of symbols) {
            // Skip markdown files, otherwise you are pretty much unable to edit markdown
            if (symbol.uri.fsPath.endsWith(".md")) {
                continue;
            }
            symbolCommentManager.insertComment(doc, new vscode.Location(symbol.uri, symbol.range));
        }
    }
}