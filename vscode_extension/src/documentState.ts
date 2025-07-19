import { EventEmitter } from "events";
import * as doc from "./api/document";
import { DocumentProcessor, WorkspaceSessionEvents } from "./api/frontend";
import { DocumentUpdateEvent, DocumentRemovedEvent } from "./api/events";
import { transformDoc } from "./documentTree";
import { flattenArray, objectFromFields, transformTree } from "./utils";
import { BackendStatus } from "./api/interface";
import { parseDocument } from "./api/markdown";
import { treeDiff } from "./documentDiff";

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
export type WithId<T> = doc.MappedElement<
	doc.Element & { elementId: ElementId },
	T
>;

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
	implements DocumentProcessor
{
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

		for (const id of oldIds.keys()) {
			if (!newIds.has(id) && id >= 0) {
				this.removeElement(id);
			}
		}

		this.documents.set(file, newDocument);

		for (const [id, element] of newIds) {
			if (!oldIds.has(id)) {
				this.addElement({
					element: element,
					file: event.doc.filename,
				});
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
		oldRoot: WithId<doc.Root>,
		newRoot: doc.Root
	): WithId<doc.Root> {
		const idGenerator = this.nextElementId.bind(this);
		const root = treeDiff<WithId<doc.Element>>(
			oldRoot as WithId<doc.Element>,
			newRoot as doc.Element,
			(node) => ({ elementId: idGenerator(), ...node })
		);

		if (root.kind !== "root") {
			throw new Error("unreachable");
		}

		return root;
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

		this.sessionEmitter.emit(
			"sectionRevealRequest",
			element.id,
			elementData.file
		);
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

export type ElementChild<E> = { field: string; value: E; index?: number };

export function nodeChildren<E extends doc.Element>(
	node: doc.MappedElement<E>
): ElementChild<doc.MappedElement<E>>[] {
	switch (node.kind) {
		case "section":
			return [
				...node.blocks.map((block, index) => ({
					field: "blocks",
					value: block,
					index: index,
				})),
				...node.children.map((child, index) => ({
					field: "children",
					value: child,
					index: index,
				})),
			];
		case "root":
			return node.blocks.map((block, index) => ({
				field: "blocks",
				value: block,
				index: index,
			}));
		case "block":
		case "bold":
		case "italics":
		case "link":
			return node.children.map((child, index) => ({
				field: "children",
				value: child,
				index: index,
			}));
		case "text":
			return [];
	}
}

function getDocElements<E extends doc.Element>(
	root: doc.MappedElement<E>
): doc.MappedElement<E>[] {
	const childArray = transformTree(
		{ field: "this", value: root } as ElementChild<doc.MappedElement<E>>,
		(node) => nodeChildren(node.value),
		(element, children: ElementChild<E>[][]) => {
			const array = flattenArray(children);
			array.push(element);
			return array;
		}
	);
	const output = childArray.map((child) => child.value);

	return output;
}

// TODO: Move to session
export const workspaceState = new WorkspaceState();
