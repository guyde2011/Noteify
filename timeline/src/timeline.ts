import * as vscode from 'vscode';

export class TimelineDay {
    resource = vscode.Uri.parse("http://google.com/sus?whodidit");
    isDirectory = true;
}

export class TimelineDaysProvider implements vscode.TreeDataProvider<TimelineDay> {
    public getTreeItem(element: TimelineDay): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return {
            resourceUri: element.resource,
            collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
            command: element.isDirectory ? void 0 : {
                command: 'ftpExplorer.openFtpResource',
                arguments: [element.resource],
                title: 'Open FTP Resource'
            }
        };
    }

    getChildren(element?: TimelineDay | undefined): vscode.ProviderResult<TimelineDay[]> {
        // returns either root for null or children of something
        return element ? [new TimelineDay()] : [new TimelineDay()];
    }
}