import * as fs from "fs";
import * as vscode from "vscode";
import { EventEmitter } from "stream";
import { Position, Uri } from "vscode";

export function listDir(dir: string): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		fs.readdir(dir, (err: any, files: string[]) => {
			if (err) {
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
				reject(err);
			} else {
				resolve(files);
			}
		});
	});
}

export async function walkDir(dir: string): Promise<string[]> {
	const dirStack = [[dir]];
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
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
		fs.writeFile(path, content, (err: NodeJS.ErrnoException | null) => {
			if (err !== null) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

export function binarySearch<T>(
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

// Assumes positions are based in characters rather than bytes
export class LineMapper {
	private readonly starts: number[] = [];
	private readonly length: number;

	constructor(text: string) {
		const lines = text.split("\n");
		lines
			.map((line) => line.length + 1)
			.reduce((total, line) => {
				this.starts.push(total);
				return total + line;
			}, 0);
		this.length = text.length;
	}

	getLineLength(lineno: number): number | undefined {
		if (lineno < 0 || lineno >= this.starts.length) {
			return;
		}
		const nextStart =
			lineno === this.starts.length - 1
				? this.length + 1
				: this.starts[lineno + 1];
		return nextStart - this.starts[lineno] - 1;
	}

	toLinePosition(position: number): Position | undefined {
		// Bigger rather than >= because position can be after a character or before it.
		if (position < 0 || position > this.length) {
			return;
		}

		const line = binarySearch(
			this.starts,
			(lineStart) => lineStart > position
		);
		return new Position(line, position - line);
	}

	toCharPosition(position: Position): number | undefined {
		if (
			position.line < 0 ||
			position.line >= this.starts.length ||
			position.character < 0 ||
			position.character > this.getLineLength(position.line)!
		) {
			return;
		}
		return this.starts[position.line] + position.character;
	}
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

		if (stack.length === 0) {
			// We've just transformed the root, let's return it
			break;
		}

		// shouldn't happen because of the current implementation
		if (stack[stack.length - 1].length === 0) {
			console.error("WTF, this shouldn't happen");
			return transform(root, []);
		}

		const element = stack[stack.length - 1].pop(); // current parent
		// Transform the current parent
		const transformed = transform(element!, outputStack.pop()!);
		outputStack[outputStack.length - 1].push(transformed);
	}

	return outputStack.pop()![0];
}

const RELEASE = false;

export function writeError(...args: any[]): void {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (RELEASE) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		console.log(...args);
	} else {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		vscode.window.showErrorMessage(...args);
	}
}

// Types taken from node types for event emitter.
type DefaultEventMap = [never];
type Key<K, T> = T extends DefaultEventMap ? string | symbol : K | keyof T;
type Listener<K, T, F> = T extends DefaultEventMap
	? F
	: K extends keyof T
	? T[K] extends unknown[]
		? (...args: T[K]) => void
		: never
	: never;
type Listener1<K, T> = Listener<K, T, (...args: any[]) => void>;

export class EventSubscriber<T extends Record<string | symbol, any[]>> {
	private listeners: [
		EventEmitter<T>,
		Key<keyof T, T>,
		Listener1<never, T>
	][] = [];

	subscribe<Ev extends keyof T>(
		emitter: EventEmitter<T>,
		event: Key<Ev, T>,
		handler: Listener1<Ev, T>
	): this {
		this.listeners.push([emitter, event, handler]);
		emitter.on(event, handler);
		return this;
	}

	dispose(): void {
		this.listeners.forEach(([emitter, event, handler]) =>
			emitter.removeListener(event, handler)
		);
		this.listeners = [];
	}
}

export function flattenArray<T>(array: T[][]): T[] {
	return ([] as T[]).concat.apply([], array);
}

type FieldObject<T extends [string, any][]> = {
	[key in keyof T & number as T[key][0]]: T[key][1];
};

export function objectFromFields<F extends [string, any][]>(
	fields: F
): FieldObject<F> {
	return Object.assign(
		{},
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		...fields.map(([key, value]) => ({ [key]: value }))
	) as FieldObject<F>;
}
