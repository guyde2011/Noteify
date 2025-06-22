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
    id: number;
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

export type Element = Root | Inline | Block;

export function isElement(value: any): value is Element {
    return value instanceof Object && Object.hasOwnProperty("kind");
}

export function isElementArray(value: any): value is Element[] {
    return (
        Array.isArray(value) &&
        ((value.length > 0 && isElement(value[0])) || value.length === 0)
    );
}