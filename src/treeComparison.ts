import * as doc from "./api/document";

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

export function childIterator<
	E extends doc.Element = doc.Element>(root: E) {
		const output = [];
		transformDoc<E[], E[], E[], E>(
			root,
			()
		)
	}

export function transformDoc<
	M extends C,
	C = any,
	A extends C = M[] & C,
	E extends doc.Element = doc.Element,
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
