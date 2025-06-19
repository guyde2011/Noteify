import { EventEmitter } from "stream";
import * as doc from "./api/document";
import { DocumentProcessor } from "./api/frontend";
import { DocumentUpdateEvent, DocumentRemovedEvent } from "./api/events";
import { transformDoc, transformTree } from "./treeComparison";

export type DocFile = string;
export type ElementId = number;

type HasId = doc.Element;

export type DiffEntry<T> =
	| { state: "unchanged"; elementId: ElementId }
	| { state: "changed"; value: T };

export type Diff<T> = T extends doc.Element
	? DiffEntry<{ [key in keyof T]: Diff<T[key]> }>
	: T extends doc.Element[]
	? { [key in keyof T]: Diff<T[key]> }
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
	? { [key in keyof T]: WithId<T[key]> } & { elementId: ElementId }
	: T extends HasId[]
	? { [key in keyof T]: WithId<T[key]> }
	: T;

type WorkspaceStateEvents = {
    "elementAdded": [element: WithId<doc.Element>];
    "elementRemoved": [element: WithId<doc.Element>];
};

export class WorkspaceState
	extends EventEmitter<WorkspaceStateEvents>
	implements DocumentProcessor
{
	documents: Map<DocFile, WithId<doc.Root>> = new Map();
	elements: Map<ElementId, doc.Element> = new Map();

	onDocumentUpdated(event: DocumentUpdateEvent): void {
		const file = event.doc.filename;
		const document = this.documents.get(file);
		if (!document) {
			this.documents.set(file, this.withIds(event.doc));
		} else {
			const diffs = this.compareDocuments(document, event.doc);
			const oldIds = new Map(
				getDocElements(document).map((element) => [
					element.elementId,
					element,
				])
			);
			const newIds = transformTree<Diff<WithId<doc.Element>>, number[]>(
				diffs,
				(node) =>
					node.state === "changed"
						? new Array<Diff<WithId<doc.Element>>>().concat.apply(
								[],
								Object.entries(node.value).map(([_, value]) => {
									if (doc.isElementArray(value)) {
										return value as unknown as Diff<
											WithId<doc.Element>
										>[];
									} else if (doc.isElement(value)) {
										return [
											value as unknown as Diff<
												WithId<doc.Element>
											>,
										];
									} else {
										return [] as Diff<
											WithId<doc.Element>
										>[];
									}
								})
						  )
						: [],
				(element, children) => {
					const ret: number[] = new Array<number>().concat.apply(
						[],
						children
					);
					if (element.state === "changed") {
						ret.push(element.value.elementId);
						this.emit(WorkspaceState.ElementAdded, element.value as WithId<doc.Element>);
					}
					return ret;
				}
			);

			const newSet = new Set(newIds);
			const oldSet = new Set(oldIds);

			for (const [id, element] of oldSet) {
				if (!newSet.has(id)) {
					this.emit(WorkspaceState.ElementRemoved, element);
				}
			}
		}
	}

	onDocumentRemoved(event: DocumentRemovedEvent): void {
		const document = this.documents.get(event.filename);
		if (!document) {
			return;
		}
		for (const element of getDocElements(document)) {
			this.emit(WorkspaceState.ElementRemoved, element);
		}
	}

	private withIds(root: doc.Root): WithId<doc.Root> {
		return transformDoc<WithId<doc.Element>>(
			root,
			(children) => children,
			(_, children) =>
				Object.assign(
					{},
					[["elementId"], this.nextElementId()],
					...children.map(([key, value]) => [[key], value])
				),
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
	): Diff<WithId<doc.Root>> {
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
		return transformDoc(
			this.withIds(newRoot),
			(elements) => elements,
			(_element, children) =>
				Diff.changed(
					Object.assign(
						{},
						...children.map(([key, value]) => [[key], value])
					)
				),
			(property) => property
		);
	}
}

export namespace WorkspaceState {
	export type ElementAdded = "elementAdded";
	export type ElementRemoved = "elementRemoved";
	export const ElementAdded: ElementAdded = "elementAdded";
	export const ElementRemoved: ElementRemoved = "elementRemoved";
}

function getDocElements(root: WithId<doc.Root>): WithId<doc.Element>[] {
	return transformDoc<
		WithId<doc.Element>[],
		WithId<doc.Element>[],
		WithId<doc.Element>[],
		WithId<doc.Element>
	>(
		root,
		(elems) => new Array<WithId<doc.Element>>().concat.apply(elems),
		(element, children) => {
			const array = new Array<WithId<doc.Element>>().concat.apply(
				[],
				children.map(([_, value]) => value)
			);
			array.push(element);
			return array;
		},
		() => []
	);
}

// TODO: Move to session
export const workspaceState = new WorkspaceState();
