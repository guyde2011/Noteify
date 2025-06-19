import { EventEmitter } from "events";
import * as doc from "./api/document";
import { DocumentProcessor, WorkspaceSessionEvents } from "./api/frontend";
import { DocumentUpdateEvent, DocumentRemovedEvent } from "./api/events";
import { transformDoc } from "./documentTree";
import { flattenArray, objectFromFields, transformTree } from "./utils";
import { BackendStatus } from "./api/interface";
import { parseDocument } from "./api/markdown";

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

export type WorkspaceFrontendEvents = {
	elementAdded: [element: WithId<doc.Element>];
	elementRemoved: [element: WithId<doc.Element>];
};

export type ElementData = {
	element: WithId<doc.Element>;
	file: doc.File;
};

export class WorkspaceState
	extends EventEmitter<WorkspaceFrontendEvents>
	implements DocumentProcessor {
	documents: Map<doc.File, WithId<doc.Root>> = new Map();
	elements: Map<ElementId, ElementData> = new Map();
	sections: Map<doc.SectionId, ElementId> = new Map();

	public readonly sessionEmitter: EventEmitter<WorkspaceSessionEvents> =
		new EventEmitter();

	onDocumentUpdated(event: DocumentUpdateEvent): void {
		const file = event.doc.filename;
		let document = this.documents.get(file) || {
			kind: "root",
			elementId: -1,
			blocks: [],
			filename: file,
		};

		const newDocument = this.updateDocument(document, event.doc);
		const newIds = new Map(
			getDocElements(newDocument).map((element) => [
				element.elementId,
				element,
			])
		);
		const oldIds = new Map(
			getDocElements(document).map((element) => [
				element.elementId,
				element,
			])
		);

		for (const [id, element] of newIds) {
			if (!oldIds.has(id)) {
				this.addElement({
					element: element,
					file: event.doc.filename,
				});
			}
		}

		for (const id of oldIds.keys()) {
			if (!newIds.has(id) && id >= 0) {
				this.removeElement(id);
			}
		}
		this.documents.set(file, newDocument);
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
		return this.elements.get(elementId)?.element;
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

	private updateDocument(
		_oldRoot: WithId<doc.Root>,
		newRoot: doc.Root
	): WithId<doc.Root> {
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
		return withIds;
	}

	private addElement(elementData: ElementData) {
		const element = elementData.element;
		this.elements.set(element.elementId, elementData);
		if (element.kind === "section") {
			this.sections.set(element.id, element.elementId);
		}
		this.emit("elementAdded", element);
	}

	private removeElement(elementId: ElementId): ElementData | undefined {
		const elementData = this.elements.get(elementId);
		if (!elementData) {
			return;
		}

		const element = elementData.element;

		if (element.kind === "section") {
			this.sections.delete(element.id);
		}

		this.elements.delete(element.elementId);
		this.emit("elementRemoved", element);
	}

	async writeSection(
		elementId: ElementId,
		newContents: string
	): Promise<FrontendStatus> {
		const elementData = this.elements.get(elementId);
		if (!elementData) {
			return FrontendStatus.NoSuchElement;
		}

		const element = elementData.element;

		if (element.kind !== "section") {
			return FrontendStatus.InvalidElement;
		}

		const parsedRoot = parseDocument("", newContents, {
			allocate: () => -1,
		});
		// Fallback if parsing failed
		let parsedSection: doc.Section = {
			kind: "section",
			id: -1,
			blocks: [
				{
					kind: "block",
					children: [{ kind: "text", content: newContents }],
				},
			],
			children: [],
			level: 0,
		};
		if (parsedRoot) {
			const section = extractMainSection(parsedRoot[0]);
			if (section) {
				parsedSection = section;
			}
		}

		parsedSection.id = element.id;

		this.sessionEmitter.emit(
			"sectionEditRequest",
			element.id,
			elementData.file,
			parsedSection
		);
		return FrontendStatus.Ok;
	}

	async revealSection(elementId: ElementId): Promise<FrontendStatus> {
		const elementData = this.elements.get(elementId);
		if (!elementData) {
			return FrontendStatus.NoSuchElement;
		}

		const element = elementData.element;

		if (element.kind !== "section") {
			return FrontendStatus.InvalidElement;
		}

		this.sessionEmitter.emit("sectionRevealRequest", element.id, elementData.file);
		return FrontendStatus.Ok;
	}
}

export enum FrontendStatus {
	Ok = 0,
	NoSuchElement = 1,
	InvalidElement = 2,
	FailedParsing,
}

function extractMainSection(root: doc.Root): doc.Section | undefined {
	if (root.blocks.length !== 1) {
		console.warn(
			"Root should have a single section child, instead got",
			root.blocks
		);
		return;
	}

	const section = root.blocks[0];
	if (section.kind !== "section") {
		console.warn("Expected section, found block!", section);
		return;
	}

	return section;
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
