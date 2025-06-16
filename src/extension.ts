import * as vscode from 'vscode';
import { symbolDocManager } from './symbolDoc';
import { initComments, makeComments, ResearchComment, symbolCommentManager } from './editorComment';
import { docManager } from './markdown';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "noteify" is now active!');

	initComments();

	let loadDocs = vscode.commands.registerCommand('noteify.loadDocs', () => {
		vscode.workspace.findFiles("**/*.md").then((files) => {
			for (const file of files) {
				docManager.indexFile(file).then(() => {
					const docs = symbolDocManager.updateDocs(file);
					makeComments(docs);
				});
			}
		});
	});
	context.subscriptions.push(loadDocs);

	vscode.commands.registerCommand('noteify.deleteThread', (thread: vscode.CommentThread) => {
		thread.dispose();
	});

	vscode.commands.registerCommand('noteify.deleteNote', (comment: ResearchComment) => {
		for (const parent of comment.parents) {
			parent.comments = parent.comments.filter(cmt => (cmt as ResearchComment).id !== comment.id);
			if (parent.comments.length === 0) {
				parent.dispose();
			}
		}
	});

	vscode.commands.registerCommand('noteify.editNote', (comment: ResearchComment) => {
		for (const parent of comment.parents) {
			parent.comments = parent.comments.map(child => {
				if ((child as ResearchComment).id === comment.id) {
					child.mode = vscode.CommentMode.Editing;
				}

				return child;
			});
		}
	});

	vscode.commands.registerCommand('noteify.saveNote', (comment: ResearchComment) => {
		comment.mode = vscode.CommentMode.Preview;
		comment.onUserEdit();
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
								const comment = symbolCommentManager.insertComment(symbolDoc, new vscode.Location(docUri, symbol.selectionRange));
								comment.mode = vscode.CommentMode.Editing;
								comment.onUserEdit();
							});
						break;
					}
				}
			}
		);
	});

}

export function deactivate() { }
