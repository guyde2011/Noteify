/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as vscode from "vscode";
import * as doc from "./api/document";
import { ElementId, WithId } from "./documentState";
import { SymbolDoc, SymbolManager, SymbolManagerEvents } from "./symbol";
import { lspProvider, SymbolData, tsProvider } from "./workspaceSymbol";
import { EventSubscriber, objectFromFields } from "./utils";
import { transformDoc } from "./documentTree";
import { extensionUri } from "./extension";

let symbolCommentController: vscode.CommentController | null = null;

export function getSymbolController() {
	return symbolCommentController;
}

export function initSymbolController() {
	symbolCommentController ??= vscode.comments.createCommentController(
		"noteify-comments",
		"Research Docs"
	);
}

// TODO: Move me after supporting more comment types.
export abstract class ResearchComment implements vscode.Comment {
	static lastCommentId = 0;

	constructor(
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public contextValue?: string | undefined,
		public parents: vscode.CommentThread[] = []
	) {
		this.id = ResearchComment.lastCommentId++;
	}

	public readonly id: number;

	abstract get body(): string | vscode.MarkdownString;
}

export class SymbolComment extends ResearchComment {
	private synchronized = true;

	constructor(
		private readonly comment: WithId<doc.Element>,
		private readonly manager: SymbolCommentManager,
		mode: vscode.CommentMode,
		author: vscode.CommentAuthorInformation,
		parents: vscode.CommentThread[] = [],
		contextValue?: string
	) {
		super(mode, author, contextValue, parents);
	}

	get body(): vscode.MarkdownString {
		if (this.synchronized) {
			return renderElement(this.comment);
		} else {
			return loadingSpinner();
		}
	}

	set body(content: string | vscode.MarkdownString) {
		this.synchronized = false;
		const workspaceState = this.manager.symbolManager.state;
		const rawContent =
			content instanceof vscode.MarkdownString ? content.value : content;
		void workspaceState.writeSection(this.comment.elementId, rawContent);
		// eslint-disable-next-line no-self-assign
		this.parents[0].comments = this.parents[0].comments;
	}

	reveal() {
		const workspaceState = this.manager.symbolManager.state;
		void workspaceState.revealSection(this.comment.elementId);
	}
}

export type CommentId = number;

export abstract class CommentsManager<D, C extends ResearchComment> {
	private commentsById: Map<CommentId, C>;

	constructor() {
		this.commentsById = new Map();
	}

	protected abstract createComment(
		data: D,
		thread: vscode.CommentThread
	): C | undefined;

	protected abstract createCommentThread(
		data: D,
		location: vscode.Location
	): vscode.CommentThread | undefined;

	getComment(commentId: CommentId): C | undefined {
		return this.commentsById.get(commentId);
	}

	insertComment(data: D, location: vscode.Location): CommentId | undefined {
		const thread = this.createCommentThread(data, location);
		if (!thread) {
			return;
		}
		const comment = this.createComment(data, thread);
		if (!comment) {
			return;
		}
		this.commentsById.set(comment.id, comment);
		return comment.id;
	}

	removeComment(commentId: CommentId): C | undefined {
		const comment = this.getComment(commentId);
		if (!comment) {
			return;
		}
		for (const parent of comment.parents) {
			parent.comments = parent.comments.filter(
				(child) =>
					!(
						child instanceof ResearchComment &&
						child.id === commentId
					)
			);
			if (parent.comments.length === 0) {
				parent.dispose();
			}
		}
		return comment;
	}
}

export class SymbolCommentManager extends CommentsManager<
	SymbolDoc,
	SymbolComment
> {
	private subscriber = new EventSubscriber<SymbolManagerEvents>();

	private commentsByElement = new Map<ElementId, CommentId[]>();

	constructor(public readonly symbolManager: SymbolManager) {
		super();

		this.subscriber
			.subscribe(symbolManager, "docAdded", this.onDocAdded.bind(this))
			.subscribe(
				symbolManager,
				"docRemoved",
				this.onDocRemoved.bind(this)
			);
	}

	dispose() {
		this.subscriber.dispose();
	}

	protected createComment(
		docs: SymbolDoc,
		thread: vscode.CommentThread
	): SymbolComment | undefined {
		const element = this.symbolManager.state.getElement(docs.element);
		if (!element) {
			return;
		}

		const comment = new SymbolComment(
			element,
			this,
			vscode.CommentMode.Preview,
			{
				name: "Researcher",
			},
			[thread]
		);

		thread.comments = [...thread.comments, comment];

		const comments = this.commentsByElement.get(docs.element);
		if (!comments) {
			this.commentsByElement.set(docs.element, [comment.id]);
		} else {
			comments.push(comment.id);
		}

		return comment;
	}

	protected createCommentThread(
		_: SymbolDoc,
		location: vscode.Location
	): vscode.CommentThread | undefined {
		const thread = symbolCommentController!.createCommentThread(
			location.uri,
			location.range,
			[]
		);
		thread.canReply = false;
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		return thread;
	}

	private onDocRemoved(doc: SymbolDoc) {
		const comments = this.commentsByElement.get(doc.element) ?? [];
		for (const commentId of comments) {
			this.removeComment(commentId);
		}
	}

	private onDocAdded(doc: SymbolDoc) {
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

		for (const relation of doc.relations) {
			void lspProvider
				.searchSymbol(relation.symbol)
				.then((lspSymbols) =>
					tsProvider
						.searchSymbol(relation.symbol)
						.then((syms) => lspSymbols.concat(syms))
				)
				.then((allSymbols) => {
					allSymbols.sort(compareSymbols);

					const symbols = [];
					for (const symbol of allSymbols) {
						let isUnique = true;
						for (let i = symbols.length - 1; i >= 0; i--) {
							const existingSymbol = symbols[i];
							if (
								symbol.uri !== existingSymbol.uri ||
								symbol.range.start.line >
								existingSymbol.range.end.line
							) {
								// We assume here symbols are a single line. thus endLine == startLine for symbols
								break;
							}
							if (
								symbol.range.intersection(existingSymbol.range)
							) {
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
						this.insertComment(
							doc,
							new vscode.Location(symbol.uri, symbol.range)
						);
					}
				});
		}
	}
}

function loadingSpinner(): vscode.MarkdownString {
	const spinnerUri = vscode.Uri.joinPath(
		extensionUri!,
		"resources",
		"spinner.svg"
	);
	const output = `<img src="${spinnerUri.toString()}" width="100%" height="60vh">
		<br/>
		<div align="center"> Please Wait ... </div>`;

	const markdownString = new vscode.MarkdownString();
	markdownString.supportHtml = true;
	markdownString.appendMarkdown(output);
	return markdownString;
}

// TODO: Move me
function renderElement(element: doc.Element): vscode.MarkdownString {
	return new vscode.MarkdownString(renderMarkdown(element));
}

export function renderMarkdown(element: doc.Element): string {
	const text = transformDoc(
		element,
		(array) => array,
		(_, fields) => {
			const mapped = objectFromFields(fields);
			switch (mapped.kind) {
				case "section": {
					const titlePrefix = "#".repeat(mapped.level as number);
					const children = (mapped.children as string[]).join("");
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					const blocks = mapped.blocks.join("\n");
					return `${titlePrefix} ${children}\n${blocks}`;
				}
				case "block":
					return (mapped.children as string[]).join("");
				case "bold":
					return `**${(mapped.children as string[]).join("")}**`;
				case "italics":
					return `*${(mapped.children as string[]).join("")}*`;
				case "text":
					return mapped.content;
				case "link": {
					const linkText = (mapped.children as string[]).join("");
					const destination = mapped.destination;
					return `[${linkText}](${destination})`;
				}
				case "root":
					return (mapped.blocks as string[]).join("\n");
			}
		},
		(value) => value
	);

	return text;
}
