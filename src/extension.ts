import * as vscode from 'vscode';
import { symbolDocManager } from './symbolDoc';
import { initComments, makeComments, ResearchComment, symbolCommentManager } from './editorComment';
import { docManager } from './markdown';
import { fileParser } from './parsing/parsing';
import { extractLSPSymbol, extractTSSymbol } from './parsing/symbol';

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
		const selectionPoint = new vscode.Range(selection, selection);
		const docUri = editor.document.uri;

		const parsedFile = fileParser.parseFile(docUri.fsPath, editor.document.getText());
		extractLSPSymbol(docUri, selectionPoint).then((symbol) => {
			// If we managed to find a symbol using the LSP
			if (symbol) {
				// Do we have tree-sitter support for this language? If we do prefer its results.
				if (parsedFile) {
					// Use the range given by the lsp rather than the selection range.
					return extractTSSymbol(parsedFile, symbol.range);
				}
				return symbol;
			} else if (parsedFile) {
				// If we have tree-sitter support, use it.
				return extractTSSymbol(parsedFile, selectionPoint);
			}
			// No way to location the symbol, `undefined` is returned
		}).then((symbol) => {
			if (!symbol) {
				// If we couldn't find a symbol, do nothing
				return;
			}
			// TODO: extract me to function
			let pickOptions = Array.from(symbolDocManager.docManager.getFiles());
			// TODO: add support for creating a new file for documentation?
			vscode.window.showQuickPick(pickOptions, { title: `Write docs of ${symbol.name} to:` }).then(
				(option) => {
					if (!option) {
						// User pressed `esc` and exited the selection menu, do nothing
						return;
					}
					const symbolDoc = symbolDocManager.createSymbolDoc(symbol.name, vscode.Uri.file(option));
					const comment = symbolCommentManager.insertComment(symbolDoc, new vscode.Location(docUri, symbol.range));
					// Open the comment for edit by default.
					comment.mode = vscode.CommentMode.Editing;
					comment.onUserEdit();
				});
		});
	});

}

export function deactivate() { }
