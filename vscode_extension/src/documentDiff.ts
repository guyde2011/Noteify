import * as doc from "./api/document";
import { ElementChild, nodeChildren } from "./documentState";
import { transformDoc } from "./documentTree";
import { objectFromFields, stringHash, transformTree } from "./utils";

export type NodeHash = number;

export type WithHash<T> = T extends doc.Element
	? {
			[key in keyof T & string]: WithHash<T[key]>;
	  } & { hash: NodeHash }
	: T extends doc.Element[]
	? WithHash<T[keyof T & number]>[]
	: T;

function elementHash(element: doc.Element): number {
	let contentHash: number;
	switch (element.kind) {
		case "text":
			contentHash = stringHash(`${element.content}`);
			break;
		case "link":
			contentHash = stringHash(`${element.destination}`);
			break;
		default:
			contentHash = 0;
	}
	return stringHash(`${element.kind}${contentHash}`);
}

function hashTree<E extends doc.Element>(element: E): WithHash<E> {
	return transformDoc<WithHash<E>>(
		element,
		(children) => children,
		(element, children) => {
			const namedHashes = [];
			for (const [field, value] of children) {
				if (doc.isElement(value)) {
					namedHashes.push([field, (value as WithHash<E>).hash]);
				} else if (doc.isElementArray(value)) {
					namedHashes.push(
						...value.map((child, index) => [
							`${field}[${index}]`,
							(child as WithHash<E>).hash,
						])
					);
				}
			}
			namedHashes.push(["", elementHash(element)]);

			const hashString = namedHashes
				.map((values) => values.join("@"))
				.join("<>");
			const hash = stringHash(hashString);
			return objectFromFields([
				["hash", hash],
				...children,
			]) as unknown as WithHash<E>;
		},
		(property) => property
	);
}

type DiffEntry<O, N> = { oldValue?: O; newValue: N };

function areNodeStringsEqual(lhs: doc.Element, rhs: doc.Element): boolean {
	if (lhs.kind !== rhs.kind) {
		return false;
	}

	switch (lhs.kind) {
		case "link":
			return lhs.destination === (rhs as doc.Link).destination;
		case "text":
			return lhs.content === (rhs as doc.Text).content;
	}
	return true;
}

export type PartiallyMappedElement<
	T extends doc.Element,
	Base = doc.Element
> = Base extends doc.Element
	? { [key in keyof Base]: doc.MappedElement<T, Base[key]> }
	: doc.MappedElement<T, Base>;

export function treeDiff<E extends doc.Element>(
	oldElement: doc.MappedElement<E>,
	newElement: doc.Element,
	mapper: (newElem: PartiallyMappedElement<E>) => doc.MappedElement<E>
): doc.MappedElement<E> {
	type NewNode = ElementChild<WithHash<doc.Element>>;
	type OldNode = ElementChild<WithHash<E>>;
	type DiffElement = {
		value: ElementChild<E>;
		updated: boolean;
	};

	const oldHashed = hashTree(oldElement);
	const newHashed = hashTree(newElement);

	const oldHashes = new Map<NodeHash, WithHash<E> | undefined>();
	transformDoc<WithHash<E>, any, WithHash<E>[], WithHash<E>>(
		oldHashed,
		(elems) => elems,
		(elem) => {
			if (oldHashes.has(elem.hash)) {
				oldHashes.set(elem.hash, undefined);
			} else {
				oldHashes.set(elem.hash, elem);
			}
			return elem;
		},
		(prop) => prop
	);

	const newHashes = new Map<NodeHash, doc.Element | null>();
	transformDoc<WithHash<doc.Element>, any, WithHash<doc.Element>[], WithHash<doc.Element>>(
		newHashed,
		(elems) => elems,
		(elem) => {
			if (newHashes.has(elem.hash)) {
				newHashes.set(elem.hash, null);
			} else {
				newHashes.set(elem.hash, elem);
			}
			return elem;
		},
		(prop) => prop
	);


	const childMap = <T extends doc.Element>(
		children: ElementChild<T>[]
	): Map<string, ElementChild<T> | ElementChild<T>[]> => {
		const map = new Map();
		for (const child of children) {
			if (child.index === undefined) {
				map.set(child.field, child);
				continue;
			}
			if (!map.has(child.field)) {
				map.set(child.field, [] as ElementChild<T>[]);
			}
			const mapChildren = map.get(child.field)!;
			if (!Array.isArray(mapChildren)) {
				console.log("unreachable");
				continue;
			}
			// TODO: DO NOT ASSUME the index children are ordered by their index.
			mapChildren.push(child);
		}
		return map;
	};

	const matchChildrenArray = (
		oldChildren: OldNode[],
		newChildren: NewNode[]
	): DiffEntry<OldNode, NewNode>[] => {
		const matchedNodes = [];
		for (
			let oldIndex = 0, newIndex = 0;
			newIndex < newChildren.length;
			newIndex++
		) {
			const newChild = newChildren[newIndex];
			while (
				oldIndex < oldChildren.length &&
				oldChildren[oldIndex].value.hash !== newChild.value.hash
			) {
				oldIndex++;
			}

			if (oldIndex >= oldChildren.length) {
				matchedNodes.push({ newValue: newChild });
				continue;
			}
			matchedNodes.push({
				oldValue: oldChildren[oldIndex++],
				newValue: newChild,
			});
		}
		return matchedNodes;
	};
	const root: DiffEntry<OldNode, NewNode> = {
		oldValue: { field: "this", value: oldHashed },
		newValue: { field: "this", value: newHashed },
	};
	// todo: rewrite algorithm
	const diffElement = transformTree<DiffEntry<OldNode, NewNode>, DiffElement>(
		root,
		(nodes: DiffEntry<OldNode, NewNode>) => {
			if (!nodes.oldValue) {
				// Try matching up the element using its hash
				const newHash = nodes.newValue.value.hash;
				if (newHashes.get(newHash) && oldHashes.get(newHash)) {
					nodes.oldValue = { field: nodes.newValue.field, value: oldHashes.get(newHash)!};
				}
			}
			if (!nodes.oldValue) {
				return nodeChildren<WithHash<doc.Element>>(
					nodes.newValue.value
				).map((node) => ({
					newValue: node,
				}));
			}
			const oldChildren = childMap(
				nodeChildren<WithHash<E>>(nodes.oldValue.value)
			);
			const newChildren = childMap(
				nodeChildren<WithHash<doc.Element>>(nodes.newValue.value)
			);

			const diffChildren: DiffEntry<OldNode, NewNode>[] = [];

			for (const [name, child] of newChildren) {
				const oldChild = oldChildren.get(name);
				if (!oldChild) {
					if (Array.isArray(child)) {
						diffChildren.push(
							...child.map((elem) => ({ newValue: elem }))
						);
					} else {
						diffChildren.push({ newValue: child });
					}
					continue;
				}

				if (Array.isArray(oldChild) && Array.isArray(child)) {
					diffChildren.push(...matchChildrenArray(oldChild, child));
					continue;
				} else if (!Array.isArray(oldChild) && !Array.isArray(child)) {
					if (oldChild.value.hash !== child.value.hash) {
						diffChildren.push({ newValue: child });
						continue;
					}
					diffChildren.push({
						oldValue: oldChild,
						newValue: child as NewNode,
					});
					continue;
				}
				diffChildren.push({ newValue: child as NewNode });
			}
			return diffChildren;
		},

		(nodes: DiffEntry<OldNode, NewNode>, children: DiffElement[]) => {
			const entries: Map<string, E | E[]> = new Map();
			let updated: boolean = false;
			for (const child of children) {
				updated ||= child.updated;

				if (child.value.index !== undefined) {
					if (!entries.has(child.value.field)) {
						entries.set(child.value.field, []);
					}
					const items = entries.get(child.value.field)!;
					if (!Array.isArray(items)) {
						console.error("WTF!");
						continue;
					}
					// TODO: Don't assume elements are ordered by their index
					items.push(child.value.value);
					continue;
				}
				entries.set(child.value.field, child.value.value);
			}

			const newFields = Array.from(entries.entries());
			const newNode = Object.assign(
				{
					...nodes.newValue.value,
				},
				objectFromFields(newFields)
			) as PartiallyMappedElement<E>;
			let node: doc.MappedElement<E>;
			if (
				updated ||
				!nodes.oldValue ||
				!areNodeStringsEqual(nodes.oldValue.value, newNode)
			) {
				node = mapper(newNode);
				updated = true;
			} else {
				node = nodes.oldValue.value;
			}

			const diffValue: ElementChild<doc.MappedElement<E>> = {
				field: nodes.newValue.field,
				index: nodes.newValue.index,
				value: node,
			};
			return {
				value: diffValue,
				updated: updated,
			};
		}
	);

	return diffElement.value.value;
	// transformTree([oldElement, newElement],
	//     ([oldElem, newElem]) => {
	//     }
	// )
}

// function treeHashes
