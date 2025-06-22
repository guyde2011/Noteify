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

export function transformDoc<
	M extends C,
	C = any,
	A extends C = M[] & C,
	E extends doc.Element = doc.Element
>(
	root: E,
	transformArray: (children: M[]) => A,
	transformElement: (element: E, children: [string, C][]) => M,
	transformProperty: (value: any) => C
): M {
	const transformed = transformElementTree<C, E>(root, (elem, children) => {
		let transformed: C;
		if (doc.isElementArray(elem)) {
			transformed = transformArray(
				children
					.filter((child) => child.childKind === "index")
					.map((child) => child.child as M)
			);
		} else if (doc.isElement(elem)) {
			transformed = transformElement(
				elem as E,
				children
					.filter((child) => child.childKind === "named")
					.map((child) => [child.name, child.child])
			);
		} else {
			transformed = transformProperty(elem);
		}
		return {
			...elem,
			child: transformed,
		};
	});
	return transformed as M;
}

export function transformElementTree<M, E extends doc.Element = doc.Element>(
	root: E,
	transform: (element: any, children: Child<M>[]) => M
): M {
	const transformed = transformTree<Child<doc.Element | string>, Child<M>>(
		Child.index(0, root),
		(current) => {
			if (doc.isElementArray(current.child)) {
				return current.child.map((elem, index) =>
					Child.index(index, elem)
				);
			} else if (doc.isElement(current.child)) {
				return Object.entries(current.child)
					.filter(([key]) => key)
					.map(([key, elem]) => Child.named(key, elem));
			} else {
				return [];
			}
		},
		(elem, children) => {
			return {
				...elem,
				child: transform(elem, children),
			};
		}
	);
	return transformed.child as M;
}
