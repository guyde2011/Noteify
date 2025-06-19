import {fromMarkdown} from "mdast-util-from-markdown";
import {gfmFromMarkdown} from "mdast-util-gfm";
import {gfm} from "micromark-extension-gfm";
import * as Md from "mdast";
import * as Doc from "./document";

export class IdAllocator {
    nextId = 0;
    allocate(): number {
        return this.nextId++;
    }
}

function parseMarkdown(contents: string): Md.Root {
    const tree = fromMarkdown(contents, {
        extensions: [gfm()],
        mdastExtensions: [gfmFromMarkdown()]
    })
    return tree;
}

function buildDocumentRec(md: Md.Node, sectionStack: (Doc.Root | Doc.Section)[], inlineParentStack: Doc.InlineParent[], idAllocator: IdAllocator): Doc.Root | null {
    const pushToSection = (b: Doc.Block) => sectionStack[sectionStack.length - 1].blocks.push(b);
    const pushInline = (b: Doc.Inline) => inlineParentStack[inlineParentStack.length - 1].children.push(b);
    const iterateChildren = (p: Md.Parent) => {
        for (const child of p.children) {
            const result = buildDocumentRec(child, sectionStack, inlineParentStack, idAllocator);
            // null means error
            if (result === null)
                return true;
        }
        return false;
    }
    const handleGenericInline = (p: Md.Parent, doc: Doc.Inline & Doc.InlineParent): null | true => {
        // We assume we are inline
        if (!inlineParentStack.length)
            return null;

        pushInline(doc);

        // Children of the link are its contents.
        inlineParentStack.push(doc);
        if (iterateChildren(p))
            return null;
        inlineParentStack.pop();
        return true;
    }

    // console.log("buildDocumentRec", md, sectionStack, inlineParentStack);

    switch (md.type) {
        case "root": {
            // Does nothing but iterate over children
            iterateChildren(md as Md.Root);
        } break;

        case "heading": {
            // We assume we are in a block
            if (inlineParentStack.length)
                return null;

            const heading = (md as Md.Heading);
            const section: Doc.Section = { kind: "section", level: heading.depth, blocks: [], children: [], id: idAllocator.allocate() };

            // Everything within its depth is considered to be its child in Noteify documents
            let parentSection = sectionStack[sectionStack.length - 1];
            while ("level" in parentSection && parentSection.level >= section.level) {
                // Escape the current parent section, at most until we reach root
                sectionStack.pop();
                parentSection = sectionStack[sectionStack.length - 1];
            }

            // Enter this section
            pushToSection(section);
            sectionStack.push(section);

            // Children of the heading itself are its contents. Parse them.
            inlineParentStack.push(section);
            if (iterateChildren(heading))
                return null;
            inlineParentStack.pop();
        } break;

        case "paragraph": {
            // We assume we are in a block
            if (inlineParentStack.length)
                return null;

            const block: Doc.ContentBlock = { kind: "block", children: [] };
            pushToSection(block);

            // Children of the paragraph are its contents. Parse them.
            inlineParentStack.push(block);
            if (iterateChildren(md as Md.Paragraph))
                return null;
            inlineParentStack.pop();
        } break;

        case "text": {
            // We assume we are inline
            if (!inlineParentStack.length)
                return null;

            const text: Doc.Text = { kind: "text", content: (md as Md.Text).value };
            pushInline(text);
        } break;

        case "link": {
            const link: Doc.Link = { kind: "link", destination: (md as Md.Link).url, children: [] };
            if (handleGenericInline(md as Md.Link, link) === null)
                return null;
        } break;

        case "strong": {
            const bold: Doc.Bold = { kind: "bold", children: [] };
            if (handleGenericInline(md as Md.Strong, bold) === null)
                return null;
        } break;

        case "emphasis": {
            const bold: Doc.Italics = { kind: "italics", children: [] };
            if (handleGenericInline(md as Md.Emphasis, bold) === null)
                return null;
        } break;

        default: {
            // Does nothing. TODO: Don't just ignore things we don't recognize!
        } break;
    }

    return sectionStack[0] as Doc.Root;
}

export function parseDocument(filename: string, markdownContents: string, idAllocator: IdAllocator): Doc.Root | null {
    const md = parseMarkdown(markdownContents);
    console.log(md);  // useful for debugging and adding features
    const root: Doc.Root = { kind: "root", filename, blocks: [] };
    return buildDocumentRec(md, [root], [], idAllocator);
}