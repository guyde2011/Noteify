import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import * as Md from "mdast";
import * as doc from "./document";
import { Position, Range } from "vscode";

export interface IdAllocator {
	allocate(): number;
}

export class SerialIdAllocator implements IdAllocator {
	private nextId = 0;
	allocate(): number {
		return this.nextId++;
	}
}

function parseMarkdown(contents: string): Md.Root {
	const tree = fromMarkdown(contents, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
	return tree;
}

// TODO: Convert to a flat (non-recursive) implementation
function buildDocumentRec(
	md: Md.Node,
	sectionStack: (doc.Root | doc.Section)[],
	inlineParentStack: doc.InlineParent[],
	idAllocator: IdAllocator,
	locationMapping: Map<doc.SectionId, Range>
): doc.Root | null {
	const pushToSection = (b: doc.Block) =>
		sectionStack[sectionStack.length - 1].blocks.push(b);
	const pushInline = (b: doc.Inline) =>
		inlineParentStack[inlineParentStack.length - 1].children.push(b);
	const iterateChildren = (p: Md.Parent) => {
		for (const child of p.children) {
			const result = buildDocumentRec(
				child,
				sectionStack,
				inlineParentStack,
				idAllocator,
				locationMapping
			);
			// null means error
			if (result === null) {
				return true;
			}
		}
		return false;
	};
	const handleGenericInline = (
		p: Md.Parent,
		doc: doc.Inline & doc.InlineParent
	): null | true => {
		// We assume we are inline
		if (!inlineParentStack.length) {
			return null;
		}

		pushInline(doc);

		// Children of the link are its contents.
		inlineParentStack.push(doc);
		if (iterateChildren(p)) {
			return null;
		}
		inlineParentStack.pop();
		return true;
	};

	const popSections = (point: Position, level: number) => {
		let parentSection = sectionStack[sectionStack.length - 1];
		while ("level" in parentSection && parentSection.level >= level) {
			// Escape the current parent section
			const popped = sectionStack.pop();
			parentSection = sectionStack[sectionStack.length - 1];

			if (!popped || popped.kind === "root") {
				console.error("Unreachable, shouldn't be able to pop root in popSections");
				return;
			}

			const titleLocation = locationMapping.get(popped.id);
			if (!titleLocation) {
				console.error(
					"Somehow created a section without adding its initial title's location"
				);
				continue;
			}
			locationMapping.set(
				popped.id,
				new Range(titleLocation.start, point)
			);
		}
	};

	// console.log("buildDocumentRec", md, sectionStack, inlineParentStack);

	switch (md.type) {
		case "root":
			{
				// Does nothing but iterate over children
				iterateChildren(md as Md.Root);
				const rootEnd = md.position!.end;
				popSections(
					new Position(rootEnd.line - 1, rootEnd.column - 1),
					-1
				);
			}
			break;

		case "heading":
			{
				// We assume we are in a block
				if (inlineParentStack.length) {
					return null;
				}

				const heading = md as Md.Heading;
				const section: doc.Section = {
					kind: "section",
					level: heading.depth,
					blocks: [],
					children: [],
					id: idAllocator.allocate(),
				};
				const mdPosition = heading.position!;
				const vsRange = new Range(
					new Position(
						mdPosition.start.line - 1,
						mdPosition.start.column - 1
					),
					new Position(
						mdPosition.end.line - 1,
						mdPosition.end.column - 1
					)
				);
				locationMapping.set(section.id, vsRange);

				popSections(vsRange.start, section.level);

				// Enter this section
				pushToSection(section);
				sectionStack.push(section);

				// Children of the heading itself are its contents. Parse them.
				inlineParentStack.push(section);
				if (iterateChildren(heading)) {
					return null;
				}
				inlineParentStack.pop();
			}
			break;

		case "paragraph":
			{
				// We assume we are in a block
				if (inlineParentStack.length) {
					return null;
				}

				const block: doc.ContentBlock = { kind: "block", children: [] };
				pushToSection(block);

				// Children of the paragraph are its contents. Parse them.
				inlineParentStack.push(block);
				if (iterateChildren(md as Md.Paragraph)) {
					return null;
				}
				inlineParentStack.pop();
			}
			break;

		case "text":
			{
				// We assume we are inline
				if (!inlineParentStack.length) {
					return null;
				}

				const text: doc.Text = {
					kind: "text",
					content: (md as Md.Text).value,
				};
				pushInline(text);
			}
			break;

		case "link":
			{
				const link: doc.Link = {
					kind: "link",
					destination: (md as Md.Link).url,
					children: [],
				};
				if (handleGenericInline(md as Md.Link, link) === null) {
					return null;
				}
			}
			break;

		case "strong":
			{
				const bold: doc.Bold = { kind: "bold", children: [] };
				if (handleGenericInline(md as Md.Strong, bold) === null) {
					return null;
				}
			}
			break;

		case "emphasis":
			{
				const bold: doc.Italics = { kind: "italics", children: [] };
				if (handleGenericInline(md as Md.Emphasis, bold) === null) {
					return null;
				}
			}
			break;

		default:
			{
				// Does nothing. TODO: Don't just ignore things we don't recognize!
			}
			break;
	}

	return sectionStack[0] as doc.Root;
}

export function parseDocument(
	filename: string,
	markdownContents: string,
	idAllocator: IdAllocator
): [doc.Root, Map<doc.SectionId, Range>] | undefined {
	const md = parseMarkdown(markdownContents);
	console.log(md); // useful for debugging and adding features
	const locationMapping = new Map();
	const root: doc.Root = { kind: "root", filename, blocks: [] };

	const document = buildDocumentRec(
		md,
		[root],
		[],
		idAllocator,
		locationMapping
	);
	if (!document) {
		return;
	}

	return [document, locationMapping];
}
