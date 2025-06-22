export type SectionId = number;

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
    filename: string;
    blocks: Block[];
};