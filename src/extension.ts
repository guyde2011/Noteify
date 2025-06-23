import * as vscode from "vscode";
import {
	initSymbolController,
	ResearchComment,
	SymbolCommentManager,
} from "./editorComment";
import { LoadStatus, Session } from "./api/Session";
import { WorkspaceState } from "./documentState";
import { SymbolManager } from "./symbol";
import { writeError } from "./utils";

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "noteify" is now active!');

	initSymbolController();

	const state = new WorkspaceState();
	const session = new Session(state);
	const symbolManager = new SymbolManager(state);
	const commentManager = new SymbolCommentManager(symbolManager);

	context.subscriptions.push(session, symbolManager, commentManager);

	const _registerCommand = (command: string, callback: (...args: never[]) => any) => { 
		context.subscriptions.push(vscode.commands.registerCommand(command, callback));
	};

	_registerCommand(
		"noteify.loadDocs",
		async () => {
			console.log("calling noteify.loadDocs");
			const status = await session.load();
			if (status === LoadStatus.Ok) {
				console.log("successfuly returned from noteify.loadDocs");
			} else {
				writeError(
					`noteify.loadDocs returned status '${status}'`
				);
			}
		}
	);

	_registerCommand(
		"noteify.deleteThread",
		(thread: vscode.CommentThread) => {
			vscode.window.showInformationMessage("Unsupported");
			/*
		thread.dispose();
		*/
		}
	);

	_registerCommand(
		"noteify.deleteNote",
		(comment: vscode.Comment) => {
			vscode.window.showInformationMessage("Unsupported");
			/*
		for (const parent of comment.parents) {
			parent.comments = parent.comments.filter(cmt => (cmt as ResearchComment).id !== comment.id);
			if (parent.comments.length === 0) {
				parent.dispose();
			}
		}
		*/
		}
	);

	_registerCommand(
		"noteify.editNote",
		(comment: vscode.Comment) => {
			if (!(comment instanceof ResearchComment)) {
				vscode.window.showInformationMessage("Unexpected comment type");
				return;
			}
			comment.mode = vscode.CommentMode.Editing;
			for (const parent of comment.parents) {
				parent.comments = parent.comments;
			}
		}
	);

	_registerCommand(
		"noteify.jumpTo",
		(comment: vscode.Comment) => {
			if (!(comment instanceof ResearchComment)) {
				vscode.window.showInformationMessage("Unexpected comment type");
				return;
			}
			/*
		comment.requestHandle.jumpTo().then(status => {
			if (status != BackendStatus.Success) {
				vscode.window.showErrorMessage(`Jump failed with error ${BackendStatusToString(status)}`);
			}
		})
		*/
		}
	);

	_registerCommand(
		"noteify.saveNote",
		(comment: vscode.Comment) => {
			if (!(comment instanceof ResearchComment)) {
				vscode.window.showInformationMessage("Unexpected comment type");
				return;
			}
			comment.mode = vscode.CommentMode.Preview;
			// TODO: Implement
			/*
		comment.requestHandle.edit(comment.markdown).then(status => {
			if (status != BackendStatus.Success) {
				vscode.window.showErrorMessage(`Edit failed with error ${BackendStatusToString(status)}`);
				// restore original contents
				comment.markdown = comment.originMarkdown;
			} else {
				// once the promise returned, we are done.
			}

			// refresh view of the comment
			comment.parentThread.comments = comment.parentThread.comments;
		});
		*/
		}
	);

	_registerCommand("noteify.addSymbolDoc", () => {
		vscode.window.showInformationMessage("Unsupported");
		/*
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const selection = editor.selection.active;
		const docUri = editor.document.uri;

		vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", docUri).then(
			(symbols: vscode.DocumentSymbol[]) => {
				for (const symbol of symbols) {
					if (symbol.selectionRange.contains(selection)) {
						let pickOptions = Array.from(symbolDocManager.docManager.getFiles());
						// pickOptions.push("Create new...");
						vscode.window.showQuickPick(pickOptions, { title: `Write docs of ${symbol.name} to:` }).then(
							(option) => {
								if (!option) {
									return;
								}
								const symbolDoc = symbolDocManager.createSymbolDoc(symbol.name, vscode.Uri.file(option));
								const comment = symbolCommentManager.insertComment(symbolDoc, new vscode.Location(docUri, symbol.selectionRange));
								comment.mode = vscode.CommentMode.Editing;
								comment.onUserEdit();
							});
						break;
					}
				}
			}
		);
		*/
	});
}

export function deactivate() {}
