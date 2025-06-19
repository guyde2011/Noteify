export type SectionId = number;
export type DocumentId = number;

export type Title = {
	kind: "title";
    level: number;
	content: string;
};

export type Link = {
	kind: "link";
	uri: string;
};

export type Text = {
	kind: "text";
	content: string;
};

export type SubSection = {
	kind: "section";
	id: SectionId;
};

export type Element = Link | Text | SubSection | Title;

export type Section = {
	children: Element[];
	parent?: SectionId;
};
