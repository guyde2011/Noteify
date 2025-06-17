import * as vscode from "vscode";
import { symbolDocManager } from "./symbolDoc";
import {
	initComments,
	showSymbolDocs,
	ResearchComment,
	symbolCommentManager,
	setThreadEdittable,
} from "./editorComment";
import { docManager } from "./markdown";
import { lspProvider, tsProvider } from "./parsing/symbol";

export function activate(context: vscode.ExtensionContext) {
	console.log('"Noteify" is starting up...');

	const registerCommand = (
		command: string,
		callback: (...args: any) => any
	) => {
		const registered = vscode.commands.registerCommand(command, callback);
		context.subscriptions.push(registered);
	};
	initComments();

	registerCommand("noteify.loadDocs", () => {
		vscode.workspace.findFiles("**/*.md").then((files) => {
			for (const file of files) {
				docManager.indexFile(file).then(() => {
					const docs = symbolDocManager.updateDocs(file);
					showSymbolDocs(docs);
				});
			}
		});
	});

	registerCommand("noteify.deleteNote", (thread: vscode.CommentThread) => {
		for (const comment of thread.comments) {
			if (!(comment instanceof ResearchComment)) {
				continue;
			}
			for (const parent of (comment as ResearchComment).parents) {
				parent.comments = parent.comments.filter(
					(cmt) => (cmt as ResearchComment).id !== comment.id
				);
				if (parent.comments.length === 0) {
					parent.dispose();
				}
			}
		}
	});

	registerCommand("noteify.editNote", (thread: vscode.CommentThread) =>
		setThreadEdittable(thread)
	);

	registerCommand("noteify.saveNote", (comment: ResearchComment) => {
		comment.mode = vscode.CommentMode.Preview;
		comment.onUserEdit();
	});

	registerCommand("noteify.expandNote", () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const selection = editor.selection;

		const parent = symbolCommentManager.getThreadAt(
			editor.document.uri,
			selection.active
		);
		if (!parent) {
			return;
		}

		parent.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

		// Prevent stealing focus from the editor if the comment is not mid-editting.
		if (
			!parent.comments.find(
				(comment) => comment.mode === vscode.CommentMode.Editing
			)
		) {
			editor.selection = selection;
		}
	});

	registerCommand("noteify.foldNote", () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const parent = symbolCommentManager.getThreadAt(
			editor.document.uri,
			editor.selection.active
		);
		if (!parent) {
			return;
		}
		// TODO: What should we do if the comment is mid-edit?
		parent.collapsibleState =
			vscode.CommentThreadCollapsibleState.Collapsed;
	});

	registerCommand("noteify.addSymbolDoc", () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const selection = editor.selection.active;
		const selectionPoint = new vscode.Range(selection, selection);
		const docUri = editor.document.uri;

		lspProvider
			.extractSymbol(docUri, selectionPoint)
			.then((symbol) => {
				// If we managed to find a symbol using the LSP
				if (symbol) {
					// Use the range given by the lsp rather than the selection range if it exists.
					const tsSymbol = tsProvider.extractSymbol(
						docUri,
						symbol.range
					);
					return tsSymbol.then((sym) => sym || symbol);
				} else {
					// If we have tree-sitter support, use it.
					return tsProvider.extractSymbol(docUri, selectionPoint);
				}
			})
			.then((symbol) => {
				if (!symbol) {
					// If we couldn't find a symbol, do nothing
					return;
				}
				// TODO: extract me to function
				let pickOptions = Array.from(
					symbolDocManager.docManager.getFiles()
				);
				// TODO: add support for creating a new file for documentation?
				vscode.window
					.showQuickPick(pickOptions, {
						title: `Write docs of ${symbol.name} to:`,
					})
					.then((option) => {
						if (!option) {
							// User pressed `esc` and exited the selection menu, do nothing
							return;
						}
						const symbolDoc = symbolDocManager.createSymbolDoc(
							symbol.name,
							vscode.Uri.file(option)
						);
						const comment = symbolCommentManager.insertComment(
							symbolDoc,
							new vscode.Location(docUri, symbol.range)
						);
						if (!comment) {
							return;
						}
						// Open the comment for edit by default.
						comment.mode = vscode.CommentMode.Editing;
						comment.onUserEdit();
					});
			});
	});

	registerCommand("noteify.editSymbolDoc", () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const parent = symbolCommentManager.getThreadAt(
			editor.document.uri,
			editor.selection.active
		);
		if (!parent) {
			return;
		}
		setThreadEdittable(parent);
		parent.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
	});
}

export function deactivate() {}
