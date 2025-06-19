import * as vscode from 'vscode';
import { initComments, CommentDoc, symbolCommentController } from './editorComment';
import { Session, SessionFrontendRequestHandle } from './api/Session';
import { BackendStatus, BackendStatusToString } from './api/interface';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "noteify" is now active!');

	initComments();

	const session = new Session({
		addDoc(textDocument: vscode.TextDocument, requestHandle: SessionFrontendRequestHandle, lineOrSymbol: number | string, markdown: string): CommentDoc | null {
			console.log(`addDoc ${lineOrSymbol} ${markdown}`);

			if (typeof lineOrSymbol !== "number") {
				// can't create
				return null;
			}

			const lineIndex = lineOrSymbol - 1;

			if (lineIndex < 0 || lineIndex >= textDocument.lineCount) {
				// can't create
				return null;
			}

			if (textDocument.uri.scheme === "comment") {
				// don't want to create comments for comments
				return null;
			}

			const thread = symbolCommentController!.createCommentThread(textDocument.uri, textDocument.lineAt(lineIndex).range, []);
			const comment = new CommentDoc(markdown, requestHandle, thread);
			thread.canReply = false;
			thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
			thread.comments = [comment];
			return comment;
		},
		delDoc(comment: CommentDoc | null): void {
			if (comment === null)
				return;

			comment.parentThread.dispose();
		},
		changeDoc(comment: CommentDoc | null, markdown: string): void {
			if (comment === null)
				return;

			comment.originMarkdown = markdown;
			comment.markdown = markdown;
			comment.parentThread.comments = comment.parentThread.comments;
		},
	});
	context.subscriptions.push(session);

	let loadDocs = vscode.commands.registerCommand('noteify.loadDocs', () => {
		console.log("calling noteify.loadDocs");
		session.load().then(status => {
			if (status == "ok") {
				console.log("successfuly returned from noteify.loadDocs");
			} else {
				vscode.window.showInformationMessage(`noteify.loadDocs returned status ${status}`);
			}
		});
	});
	context.subscriptions.push(loadDocs);

	vscode.commands.registerCommand('noteify.deleteThread', (thread: vscode.CommentThread) => {
		vscode.window.showInformationMessage("Unsupported");
		/*
		thread.dispose();
		*/
	});

	vscode.commands.registerCommand('noteify.deleteNote', (comment: vscode.Comment) => {
		vscode.window.showInformationMessage("Unsupported");
		/*
		for (const parent of comment.parents) {
			parent.comments = parent.comments.filter(cmt => (cmt as ResearchComment).id !== comment.id);
			if (parent.comments.length === 0) {
				parent.dispose();
			}
		}
		*/
	});

	vscode.commands.registerCommand('noteify.editNote', (comment: vscode.Comment) => {
		if (!(comment instanceof CommentDoc)) {
			vscode.window.showInformationMessage("Unexpected comment type");
			return;
		}
		comment.mode = vscode.CommentMode.Editing;
		comment.parentThread.comments = comment.parentThread.comments;
	});

	vscode.commands.registerCommand('noteify.jumpTo', (comment: vscode.Comment) => {
		if (!(comment instanceof CommentDoc)) {
			vscode.window.showInformationMessage("Unexpected comment type");
			return;
		}
		comment.requestHandle.jumpTo().then(status => {
			if (status != BackendStatus.Success) {
				vscode.window.showErrorMessage(`Jump failed with error ${BackendStatusToString(status)}`);
			}
		})
	});

	vscode.commands.registerCommand('noteify.saveNote', (comment: vscode.Comment) => {
		if (!(comment instanceof CommentDoc)) {
			vscode.window.showInformationMessage("Unexpected comment type");
			return;
		}
		comment.mode = vscode.CommentMode.Preview;
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
		})
	});

	vscode.commands.registerCommand('noteify.addSymbolDoc', () => {
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

export function deactivate() { }
