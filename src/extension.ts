import * as vscode from 'vscode';
import { symbolDocManager } from './symbolDoc';
import { initComments, makeComments, ResearchComment, symbolCommentController, symbolCommentManager } from './editorComment';
import { docManager } from './backends/localFiles';
import Session from './backends/Session';

class MishaComment implements vscode.Comment {
    constructor(
	    public markdown: string,
        public mode: vscode.CommentMode = vscode.CommentMode.Preview,
        public author: vscode.CommentAuthorInformation = { name: "Researcher" },
        public parents: vscode.CommentThread[] = [],
    ) {};

    get body(): vscode.MarkdownString {
        return new vscode.MarkdownString(this.markdown);
    }
    isEditable(): boolean {
        return false;
    }
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "noteify" is now active!');

	initComments();

	const session = new Session({
		addDoc(textDocument: vscode.TextDocument, lineOrSymbol: number | string, markdown: string): vscode.CommentThread {
			console.log(`addDoc ${lineOrSymbol} ${markdown}`);
			if (typeof lineOrSymbol !== "number")
				throw "aaaaa";

			if (lineOrSymbol >= textDocument.lineCount) {
				// resiliency
				lineOrSymbol = 0;
			}
			const comment = new MishaComment(markdown);
			const thread = symbolCommentController!.createCommentThread(textDocument.uri, textDocument.lineAt(lineOrSymbol).range, [comment]);
			return thread;
		},
		delDoc(textDocument: vscode.TextDocument, comment: vscode.CommentThread): void {
		},
		changeDoc(textDocument: vscode.TextDocument, comment: vscode.CommentThread, markdown: string): void {
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
