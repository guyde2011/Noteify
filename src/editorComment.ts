import * as vscode from "vscode";
import { extractIDESymbolName, Symbol, SymbolDoc, SymbolDocManager } from "./symbolDoc";

export var symbolCommentController: vscode.CommentController | null = null;
var lastCommentId = 0;

// TODO: Move me after supporting more comment types.
export abstract class ResearchComment implements vscode.Comment {
    constructor(
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public contextValue?: string | undefined,
        public parent?: vscode.CommentThread
    ) {
        this.id = lastCommentId++;
    };

    public readonly id: number;

    abstract get body(): string | vscode.MarkdownString;
    abstract isEditable(): boolean;
    abstract edit(content: string | vscode.MarkdownString): Promise<void>;
}

export class SymbolComment extends ResearchComment {
    constructor(
        public docs: SymbolDoc,
        mode: vscode.CommentMode,
        author: vscode.CommentAuthorInformation,
        parent?: vscode.CommentThread,
        contextValue?: string | undefined,
    ) {
        super(mode, author, contextValue, parent);
    }

    get body(): vscode.MarkdownString {
        return new vscode.MarkdownString(this.docs.docs.section.getContent());
    }

    isEditable(): boolean {
        return true;
    }

    edit(content: string | vscode.MarkdownString): Promise<void> {
        // TODO: Save ranges of symbol docs for edit support
        throw new Error("Method not implemented.");
    }

}

export function initComments() {
    if (symbolCommentController === null) {
        symbolCommentController = vscode.comments.createCommentController('noteify-comments', "Research Docs");
    }
}

export async function createSymbolDocThread(symbolDoc: SymbolDoc, location: vscode.Location, author?: vscode.CommentAuthorInformation) {
    const comment = new SymbolComment(symbolDoc, vscode.CommentMode.Preview, (author !== undefined) ? author : { name: "Researcher" });
    const thread = symbolCommentController!.createCommentThread(location.uri, location.range, [comment]);
    comment.parent = thread;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
}

export async function makeComments(docs: SymbolDoc[]) {
    for (const doc of docs) {
        const wsSymbols: vscode.SymbolInformation[] = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", doc.symbol);
        for (const wsSymbol of wsSymbols) {
            createSymbolDocThread(doc, wsSymbol.location);
        }
    }
}