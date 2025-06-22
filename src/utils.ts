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

export function transformTree<T, F>(
	root: T,
	children: (node: T) => T[],
	transform: (node: T, children: F[]) => F
): F {
	const stack: T[][] = [[root]];
	const outputStack: F[][] = [[]];

	while (stack.length > 0) {
		const top = stack[stack.length - 1];
		if (top.length > 0) {
			const curElem = top[top.length - 1];
			stack.push(children(curElem));
			outputStack.push([]);
			continue;
		}

		stack.pop();
		// shouldn't happen because of the current implementation
		if (stack.length === 0 || stack[stack.length - 1].length === 0) {
			console.error("WTF, this shouldn't happen");
			return transform(root, []);
		}
		const element = stack[stack.length - 1].pop();
		const transformed = transform(element!, outputStack.pop()!);
		outputStack[outputStack.length - 1].push(transformed);
	}

	return outputStack.pop()![0]!;
}

const RELEASE: boolean = false;

export function writeError(...args: any[]) {
    if (RELEASE) {
        console.log(...args);
    } else {
        const vscode = require("vscode");
        vscode.window.showErrorMessage(...args);
    }
}
