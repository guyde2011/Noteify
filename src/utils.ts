import * as fs from "fs";
import { Position, Range, Uri } from "vscode";

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
	const path = file instanceof Uri ? file.fsPath : file;

	return new Promise<string>((resolve, reject) => {
		fs.readFile(path, "utf8", (err: any, data: string) => {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
}

export function writeFile(file: Uri | string, content: string): Promise<void> {
	const path = file instanceof Uri ? file.fsPath : file;

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

function binarySearch<T>(
	array: T[],
	afterTarget: (value: T) => boolean
): number {
	let low = 0;
	let high = array.length;

	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (afterTarget(array[mid])) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}
	return low;
}

// TODO: replace arrays impl with B-Tree.
// Assumes ranges are non-intersecting
export class RangeMap<T> {
	private elements: [Range, T][] = [];

	constructor() {}

	/**
	 * Inserts an element with the given associated range, if it has no intersection with any other inserted ranges.
	 * @param range The range of the inserted element
	 * @param value The value of the inserted element
	 * @returns Whether the element was successfully inserted
	 */
	insert(range: Range, value: T): boolean {
		// TODO: find an elegant way to not calculate insertion index twice
		const index = this.getInsertionIndex(range);
		this.elements.splice(index, 0, [range, value]);
		return true;
	}

	getIntersectingElement(range: Range): [Range, T] | undefined {
		const index = this.getInsertionIndex(range);

        // Index after insertion has intersection
        if (index < this.elements.length &&
				this.elements[index][0].contains(range)) {
                    return this.elements[index];
            }

        // Index before insertion has intersection
		if (index > 0 && this.elements[index - 1][0].contains(range)) {
            return this.elements[index - 1];
        }

        return;
	}

    get(position: Position): [Range, T] | undefined {
		return this.getIntersectingElement(new Range(position, position));
    }

	private getInsertionIndex(range: Range): number {
		return binarySearch(this.elements, ([elemRange, _]) =>
			elemRange.start.isAfter(range.start)
		);
	}
}
