export type SectionId = number;
export type File = string;

export interface BlockParent {
	blocks: Block[];
}

export interface InlineParent {
	children: Inline[];
}

export type Section = {
	kind: "section";
	level: number;
	blocks: Block[];
	children: Inline[];
	id: SectionId;
};

export type ContentBlock = {
	kind: "block";
	children: Inline[];
};

export type Text = {
	kind: "text";
	content: string;
};

export type Bold = {
	kind: "bold";
	children: Inline[];
};

export type Italics = {
	kind: "italics";
	children: Inline[];
};

export type Link = {
	kind: "link";
	destination: string;
	children: Inline[];
};

export type Inline = Text | Bold | Italics | Link;
export type Block = Section | ContentBlock;

export type Root = {
	kind: "root";
	filename: File;
	blocks: Block[];
};

export type Element = Root | Inline | Block;

export type MappedElement<E extends Element, Base = Element> = Base &
	(Base extends Element
		? { [key in keyof Base & string]: MappedElement<E, Base[key]> } & E
		: Base extends Element[]
		? {
				[key in keyof Base & (number | "length")]: MappedElement<
					E,
					Base[key]
				>;
		  }
		: Base);

export function isElement(value: any): value is Element {
	return value instanceof Object && value.hasOwnProperty("kind");
}

export function isElementArray(value: any): value is Element[] {
	return (
		Array.isArray(value) &&
		((value.length > 0 && isElement(value[0])) || value.length === 0)
	);
}
