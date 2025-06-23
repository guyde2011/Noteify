import * as doc from "./api/document";
import { transformTree } from "./utils";

export type Child<T> =
	| { childKind: "index"; index: number; child: T }
	| { childKind: "named"; name: string; child: T };

export namespace Child {
	export function named<T>(name: string, child: T): Child<T> {
		return {
			childKind: "named",
			name: name,
			child: child,
		};
	}
	export function index<T>(index: number, child: T): Child<T> {
		return {
			childKind: "index",
			index: index,
			child: child,
		};
	}
}

type AllValues<E> =
	| E
	| (E extends doc.Element[]
			? E[keyof E]
			: E extends doc.Element
			? AllValues<E[keyof E]>
			: never);

export function transformDoc<
	M extends C,
	C = any,
	A extends C = M[] & C,
	E extends doc.Element = doc.Element
>(
	root: E,
	transformArray: (children: M[]) => A,
	transformElement: (element: E, children: [string, C][]) => M,
	transformProperty: (value: AllValues<E>) => C
): M {
	const transformed = transformElementTree<C, E>(root, (elem, children) => {
		if (doc.isElementArray(elem)) {
			return transformArray(
				children
					.filter((child) => child.childKind === "index")
					.map((child) => child.child as M)
			);
		} else if (doc.isElement(elem)) {
			const namedChildren = [] as (Child<C> & {
				childKind: "named";
				name: string;
			})[];
			children.forEach((child) => {
				if (child.childKind === "named") {
					namedChildren.push(child);
				}
			});
			return transformElement(
				elem as E,
				namedChildren.map((child) => [child.name, child.child])
			);
		} else {
			return transformProperty(elem);
		}
	});
	return transformed as M;
}

export function transformElementTree<M, E extends doc.Element = doc.Element>(
	root: E,
	transform: (element: AllValues<E>, children: Child<M>[]) => M
): M {
	const transformed = transformTree<Child<AllValues<E>>, Child<M>>(
		Child.index(0, root),
		(current) => {
			if (doc.isElementArray(current.child)) {
				return current.child.map((elem, index) =>
					Child.index(index, elem)
				);
			} else if (doc.isElement(current.child)) {
				return Object.entries(current.child).map(([key, elem]) =>
					Child.named(key, elem)
				);
			} else {
				return [];
			}
		},
		(elem, children) => {
			return Object.assign({}, elem, {
				child: transform(elem.child, children),
			});
		}
	);
	return transformed.child as M;
}
