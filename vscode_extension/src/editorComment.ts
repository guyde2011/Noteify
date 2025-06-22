import * as vscode from "vscode";
import * as doc from "./api/document";
import { ElementId, WithId } from "./documentState";
import { SymbolDoc, SymbolManager, SymbolManagerEvents } from "./symbol";
import { lspProvider, SymbolData } from "./workspaceSymbol";
import { EventSubscriber, objectFromFields } from "./utils";
import { transformDoc } from "./documentTree";

let symbolCommentController: vscode.CommentController | null = null;

export function getSymbolController() {
	return symbolCommentController;
}

export function initSymbolController() {
	if (symbolCommentController === null) {
		symbolCommentController = vscode.comments.createCommentController(
			"noteify-comments",
			"Research Docs"
		);
	}
}

// TODO: Move me after supporting more comment types.
export abstract class ResearchComment implements vscode.Comment {
	static lastCommentId: number = 0;

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
	constructor(
		private readonly comment: WithId<doc.Element>,
		mode: vscode.CommentMode,
		author: vscode.CommentAuthorInformation,
		parents: vscode.CommentThread[] = [],
		contextValue?: string | undefined
	) {
		super(mode, author, contextValue, parents);
	}

	get body(): vscode.MarkdownString {
		return renderElement(this.comment);
	}

	set body(content: string | vscode.MarkdownString) {
		// TODO: Impelement
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
		thread.comments = [...thread.comments, comment];
		this.commentsById.set(comment.id, comment);
		comment.parents.push(thread);
		return comment.id;
	}
}

export class SymbolCommentManager extends CommentsManager<
	SymbolDoc,
	SymbolComment
> {
	private subscriber: EventSubscriber<SymbolManagerEvents> =
		new EventSubscriber();
	constructor(private readonly symbolManager: SymbolManager) {
		super();

		this.subscriber.subscribe(
			symbolManager,
			"docAdded",
			this.onDocAdded.bind(this)
		).subscribe(symbolManager, "docRemoved", this.onDocRemoved.bind(this));
	}

	protected createComment(
		docs: SymbolDoc,
		thread: vscode.CommentThread
	): SymbolComment | undefined {
		const element = this.symbolManager.state.getElement(docs.element);
		if (!element) {
			return;
		}
		return new SymbolComment(
			element,
			vscode.CommentMode.Preview,
			{
				name: "Researcher",
			},
			[thread]
		);
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
		// TODO: implement
	}

	private onDocAdded(doc: SymbolDoc) {
		console.log("onDocAdded", doc);
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
			lspProvider.searchSymbol(relation.symbol).then((allSymbols) => {
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
					this.insertComment(
						doc,
						new vscode.Location(symbol.uri, symbol.range)
					);
				}
			});
		}
	}
}

// TODO: Move me
function renderElement(element: doc.Element): vscode.MarkdownString {
	return new vscode.MarkdownString(_renderElement(element));
}

type Rendered<T> = T extends doc.Element
	? {
			[key in keyof T & string]: Rendered<T[key]>;
	  } & { elementId: ElementId }
	: T extends doc.Element[]
	? Rendered<T[keyof T & number]>[]
	: T;

function _renderElement(element: doc.Element): string {
	return transformDoc(
		element,
		(array) => array,
		(_, fields) => {
			const mapped = objectFromFields(fields);
			switch (mapped.kind) {
				case "section":
					const titlePrefix = "#".repeat(mapped.level);
					const children = mapped.children.join("");
					const blocks = mapped.blocks.join("\n");
					return `${titlePrefix} ${children}\n${blocks}`;
				case "block":
					return mapped.children.join("");
				case "bold":
					return `**${mapped.children.join("")}**`;
				case "italics":
					return `*${mapped.children.join("")}*`;
				case "text":
					return mapped.content;
				case "link":
					const linkText = mapped.children.join("");
					const destination = mapped.destination;
					return `[${linkText}](${destination})`;
				case "root":
					return mapped.blocks.join("\n");
			}
		},
		(value) => value
	);
}
