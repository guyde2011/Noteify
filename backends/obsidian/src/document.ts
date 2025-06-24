export type SectionId = number;

export interface BlockParent {
    blocks: Block[];
}

export interface InlineParent {
    children: Inline[];
}

export interface Section {
    kind: "section";
    level: number;
    blocks: Block[];
    children: Inline[];
    id: SectionId;
}

export interface ContentBlock {
    kind: "block";
    children: Inline[];
}

export interface Text {
    kind: "text";
    content: string;
}

export interface Bold {
    kind: "bold";
    children: Inline[];
}

export interface Italics {
    kind: "italics";
    children: Inline[];
}

export interface Link {
    kind: "link";
    destination: string;
    children: Inline[];
}

export type Inline = Text | Bold | Italics | Link;
export type Block = Section | ContentBlock;

export interface Root {
    kind: "root";
    filename: string;
    blocks: Block[];
}