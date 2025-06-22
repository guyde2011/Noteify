import { EventEmitter } from "stream";
import * as doc from "./api/document";
import { DocumentProcessor } from "./api/frontend";
import { DocumentUpdateEvent, DocumentRemovedEvent } from "./api/events";
import { transformDoc } from "./documentTree";
import { flattenArray, objectFromFields, transformTree } from "./utils";

export type DocFile = string;
export type ElementId = number;

type HasId = doc.Element;

export type DiffEntry<T> =
	| { state: "unchanged"; elementId: ElementId }
	| { state: "changed"; value: T };

export type Diff<T> = T extends doc.Element
	? DiffEntry<{ [key in keyof T & string]: Diff<T[key]> }>
	: T extends doc.Element[]
	? Diff<T[keyof T & number]>[]
	: T;

export namespace Diff {
	export function changed<T>(element: T): DiffEntry<T> {
		return { state: "changed", value: element };
	}

	export function unchanged(elementId: ElementId): DiffEntry<never> {
		return { state: "unchanged", elementId: elementId };
	}
}
export type WithId<T> = T extends HasId
	? {
			[key in keyof T & string]: WithId<T[key]>;
	  } & { elementId: ElementId }
	: T extends HasId[]
	? WithId<T[keyof T & number]>[]
	: T;

export type WorkspaceStateEvents = {
	elementAdded: [element: WithId<doc.Element>];
	elementRemoved: [element: WithId<doc.Element>];
};

export class WorkspaceState
	extends EventEmitter<WorkspaceStateEvents>
	implements DocumentProcessor
{
	documents: Map<DocFile, WithId<doc.Root>> = new Map();
	elements: Map<ElementId, WithId<doc.Element>> = new Map();

	onDocumentUpdated(event: DocumentUpdateEvent): void {
		const file = event.doc.filename;
		let document = this.documents.get(file) || {
			kind: "root",
			elementId: -1,
			blocks: [],
			filename: file,
		};

		const diffs = this.compareDocuments(document, event.doc);
		const oldIds = new Map(
			getDocElements(document).map((element) => [
				element.elementId,
				element,
			])
		);
		const newIds = diffs.map((diff) => diff.elementId);

		for (const element of diffs) {
			this.addElement(element);
		}

		const newSet = new Set(newIds);
		const oldSet = new Set(oldIds);

		for (const [id, element] of oldSet) {
			if (!newSet.has(id) && id >= 0) {
				this.removeElement(element.elementId);
			}
		}
	}

	onDocumentRemoved(event: DocumentRemovedEvent): void {
		const document = this.documents.get(event.filename);
		if (!document) {
			return;
		}
		for (const element of getDocElements(document)) {
			this.removeElement(element.elementId);
		}
	}

	getElement(elementId: ElementId): WithId<doc.Element> | undefined {
		return this.elements.get(elementId);
	}

	private withIds(root: doc.Root): WithId<doc.Root> {
		return transformDoc<WithId<doc.Element>>(
			root,
			(children) => children,
			(_, children) =>
				objectFromFields([
					["elementId", this.nextElementId()],
					...children,
				]) as unknown as WithId<doc.Element>,
			(property) => property
		) as WithId<doc.Root>;
	}

	private lastElementId: ElementId = 0;
	private nextElementId(): ElementId {
		return this.lastElementId++;
	}

	private compareDocuments(
		_oldRoot: WithId<doc.Root>,
		newRoot: doc.Root
	): WithId<doc.Element>[] {
		// const transformed = transformTree(
		// 	Child.index(0, [oldRoot, newRoot]),
		// 	([oldNode. newNode]) => {
		// 		if (isElementArray(oldNode.child)) {
		// 			return current.child.map((elem, index) =>
		// 				Child.index(index, elem)
		// 			);
		// 		} else if (isElement(current.child)) {
		// 			return Object.entries(current.child).filter(([key]) => key).map(([key, elem]) =>
		// 				Child.named(key, elem)
		// 			);
		// 		} else {
		// 			return [];
		// 		}
		// 	},
		// 	(elem, children) => {
		// 		return {
		// 			...elem,
		// 			child: transform(elem, children),
		// 		};
		// 	}
		// );
		// transformTree<Child<Element>>([oldRoot, newRoot], ([oldNode, newNode]) => {
		//     oldNode.
		// })
		// TODO: Real implementation that doesn't say that everything changed
		const withIds = this.withIds(newRoot);
		return transformDoc(
			withIds,
			(elements) => flattenArray(elements),
			(element, children) => {
				const output: WithId<doc.Root>[] = flattenArray(
					children.map(([_key, value]) => value)
				);
				output.push(element);
				return output;
			},
			(_) => [] as WithId<doc.Element>[]
		);
	}

	private addElement(element: WithId<doc.Element>) {
		this.elements.set(element.elementId, element);
		this.emit("elementAdded", element);
	}

	private removeElement(elementId: ElementId): doc.Element | undefined {
		const element = this.elements.get(elementId);
		if (!element) {
			return;
		}
		this.elements.delete(element.elementId);
		this.emit("elementRemoved", element);
	}
}

function getDocElements(root: WithId<doc.Root>): WithId<doc.Element>[] {
	const out = transformDoc<
		WithId<doc.Element>[],
		WithId<doc.Element>[],
		WithId<doc.Element>[],
		WithId<doc.Element>
	>(
		root,
		(elems) => flattenArray(elems),
		(element, children) => {
			const array = flattenArray(
				children
					.filter(([_, value]) => doc.isElementArray(value))
					.map(([_, value]) => value)
			);
			array.push(element);
			return array;
		},
		() => []
	);
	return out;
}

// TODO: Move to session
export const workspaceState = new WorkspaceState();
