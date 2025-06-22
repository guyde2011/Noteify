import * as vscode from 'vscode';
import { TimelineDaysProvider } from './timeline';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "timeline" is now active!');

	const disposable = vscode.commands.registerCommand('timeline.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from timeline!');
	});
	context.subscriptions.push(disposable);

	const treeView = vscode.window.createTreeView('timeline-days', { treeDataProvider: new TimelineDaysProvider() });
	context.subscriptions.push(treeView);
}

// This method is called when your extension is deactivated
export function deactivate() {}
