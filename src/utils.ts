import * as fs from "fs";
import { Uri } from "vscode";


export function listDir(dir: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        fs.readdir(dir, (err: any, files: string[]) => {
            if (err) {
                reject(err);
            } else {
                resolve(files);
            }

        });
    });
}

export function stat(file: string): Promise<fs.Stats> {
     return new Promise<fs.Stats>((resolve, reject) => {
        fs.stat(file, (err: any, files: fs.Stats) => {
            if (err) {
                reject(err);
            } else {
                resolve(files);
            }
        });
    });
}

export async function walkDir(dir: string): Promise<string[]> {
    let dirStack = [[dir]];
    const output = [];
    while (dirStack.length > 0) {
        if (dirStack[dirStack.length - 1].length === 0) {
            dirStack.pop();
            dirStack[dirStack.length - 1].pop();
            continue;
        }
        const queue = dirStack[dirStack.length - 1];
        const curFile = queue[queue.length - 1];
        if ((await stat(curFile)).isDirectory()) {
            const fileNames = await listDir(curFile);
            dirStack.push(fileNames.map((name) => `${curFile}/${name}`));
        } else {
            output.push(curFile);
            dirStack.pop();
        }
    }
    return output;
}

export function readFile(file: Uri | string): Promise<string> {
    const path = (file instanceof Uri) ? file.fsPath : file;

    return new Promise<string>((resolve, reject) => {
        fs.readFile(path, 'utf8', (err: any, data: string) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }

        });
    });
}

export function writeFile(file: Uri | string, content: string): Promise<void> {
    const path = (file instanceof Uri) ? file.fsPath : file;

    return new Promise<void>((resolve, reject) => {
        fs.writeFile(path, content, (err: any, data: void) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }

        });
    });
}