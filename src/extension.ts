import * as vscode from 'vscode';
import { symbolDocManager } from './symbolDoc';
import { createSymbolDocThread, initComments, makeComments, ResearchComment, symbolCommentController } from './editorComment';
import { DocsManager } from './markdown';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "noteify" is now active!');

	initComments();
	const docsManager = new DocsManager();


	let loadDocs = vscode.commands.registerCommand('noteify.loadDocs', () => {
		vscode.workspace.findFiles("**/*.md").then(async (files) => {
			for (const file of files) {
				await docsManager.indexFile(file);
				console.log("Aaaa");
				const docs = symbolDocManager.updateDocs(file);
				console.log("bbbb", docs);
				makeComments(docs);
			}
		});
	});
	context.subscriptions.push(loadDocs);

	vscode.commands.registerCommand('noteify.deleteThread', (thread: vscode.CommentThread) => {
		thread.dispose();
	});

	vscode.commands.registerCommand('noteify.deleteNote', (comment: ResearchComment) => {
		const thread = comment.parent;
		if (!thread) {
			return;
		}

		thread.comments = thread.comments.filter(cmt => (cmt as ResearchComment).id !== comment.id);

		if (thread.comments.length === 0) {
			thread.dispose();
		}
	});

	vscode.commands.registerCommand('noteify.editNote', (comment: ResearchComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(child => {
			if ((child as ResearchComment).id === comment.id) {
				child.mode = vscode.CommentMode.Editing;
			}

			return child;
		});
	});


	vscode.commands.registerCommand('noteify.addSymbolDoc', () => {
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
								createSymbolDocThread(symbolDoc, new vscode.Location(docUri, symbol.selectionRange));
						});
						break;
					}
				}
			}
		);
	});

}

export function deactivate() { }
