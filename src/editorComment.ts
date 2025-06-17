import * as vscode from "vscode";
import { LinkedDoc, SymbolDoc } from "./symbolDoc";
import { lspProvider, SymbolData, tsProvider } from "./parsing/symbol";
import { RangeMap } from "./utils";

export var symbolCommentController: vscode.CommentController | null = null;
var lastCommentId = 0;

// TODO: Move me after supporting more comment types.
export abstract class ResearchComment implements vscode.Comment {
	constructor(
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public contextValue?: string | undefined,
		public parents: vscode.CommentThread[] = []
	) {
		this.id = lastCommentId++;
	}

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
		contextValue?: string | undefined
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

export type CommentId = number;

export abstract class CommentsManager<
	D extends LinkedDoc,
	C extends ResearchComment
> {
	private commentsById: Map<CommentId, [D, C]> = new Map();
	private commentsByLocation: Map<string, RangeMap<CommentId>> = new Map();

	constructor() {}

	protected abstract createComment(docs: D): C;
	protected abstract createCommentThread(
		docs: D,
		comment: C,
		location: vscode.Location
	): vscode.CommentThread;

	/**
	 * Inserts the given comment at the given location. The comment is only inserted
	 * if its location doesn't intersect with any other comment's location.
	 * @param docs the corresponding doc for the comment
	 * @param location the location to place the comment at
	 * @returns the inserted comment on success, otherwise undefined.
	 */
	insertComment(docs: D, location: vscode.Location): C | undefined {
		if (!this.commentsById.has(docs.innerId)) {
			this.commentsById.set(docs.innerId, [
				docs,
				this.createComment(docs),
			]);
		}

		const locationKey = location.uri.fsPath;
		if (!this.commentsByLocation.has(locationKey)) {
			this.commentsByLocation.set(locationKey, new RangeMap());
		}
		const uriComments = this.commentsByLocation.get(locationKey)!;
		if (!uriComments.insert(location.range, docs.innerId)) {
			return;
		}

		const [_, comment] = this.commentsById.get(docs.innerId)!;
		const thread = this.createCommentThread(docs, comment, location);

		comment.parents.push(thread);
		return comment;
	}

	getCommentAt(uri: vscode.Uri, position: vscode.Position): C | undefined {
		const locationKey = uri.fsPath;
		if (!this.commentsByLocation.has(locationKey)) {
			return;
		}
		const uriComments = this.commentsByLocation.get(locationKey)!;
		const elem = uriComments.get(position);
		if (!elem) {
			return;
		}
		const commentId = elem[1];
		return this.commentsById.get(commentId)![1];
	}

	getThreadAt(
		uri: vscode.Uri,
		position: vscode.Position
	): vscode.CommentThread | undefined {
		const comment = this.getCommentAt(uri, position);
		if (!comment) {
			return;
		}
		for (const parent of comment.parents) {
			if (
				parent.uri.fsPath === uri.fsPath &&
				parent.range &&
				parent.range?.contains(position)
			) {
				return parent;
			}
		}
	}
}

export class SymbolCommentManager extends CommentsManager<
	SymbolDoc,
	SymbolComment
> {
	protected createComment(docs: SymbolDoc): SymbolComment {
		return new SymbolComment(docs, vscode.CommentMode.Preview, {
			name: "Researcher",
		});
	}

	protected createCommentThread(
		_: SymbolDoc,
		comment: SymbolComment,
		location: vscode.Location
	): vscode.CommentThread {
		const thread = symbolCommentController!.createCommentThread(
			location.uri,
			location.range,
			[comment]
		);
		thread.canReply = false;
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		return thread;
	}
}

export var symbolCommentManager = new SymbolCommentManager();

export function initComments() {
	if (symbolCommentController === null) {
		symbolCommentController = vscode.comments.createCommentController(
			"noteify-comments",
			"Research Docs"
		);
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
			if (uriComp !== 0) {
				return uriComp;
			}
			const lineComp = lhs.range.start.line - rhs.range.start.line;
			if (lineComp !== 0) {
				return lineComp;
			}
			return lhs.range.start.character - rhs.range.start.character;
		};

		allSymbols.sort(compareSymbols);

		const symbols = [];
		for (const symbol of allSymbols) {
			let isUnique = true;
			for (let i = symbols.length - 1; i >= 0; i--) {
				const existingSymbol = symbols[i];
				if (
					symbol.uri !== existingSymbol.uri ||
					symbol.range.start.line > existingSymbol.range.end.line
				) {
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
			symbolCommentManager.insertComment(
				doc,
				new vscode.Location(symbol.uri, symbol.range)
			);
		}
	}
}

export function setThreadEdittable(thread: vscode.CommentThread) {
	for (const comment of thread.comments) {
		if (!(comment instanceof ResearchComment)) {
			continue;
		}
		for (const parent of (comment as ResearchComment).parents) {
			parent.comments = parent.comments.map((child) => {
				if ((child as ResearchComment).id === comment.id) {
					child.mode = vscode.CommentMode.Editing;
				}

				return child;
			});
		}
	}
}
