import { Uri } from "vscode";
import { Section } from "./api/document";
import { DocumentProcessor } from "./api/frontend";
import { writeError } from "./utils";

type Symbol = string;

enum DocRelation {
	Title = "title",
	Link = "link",
}

type SymbolIdentifier = {
	name: string;
	uri?: string;
};

type SymbolDoc = {
	symbol: SymbolIdentifier;
	relation: DocRelation;
};

/*
function parseSymbol(rawSymbol: string): SymbolIdentifier | undefined {
	try {
		const uri = Uri.parse(rawSymbol);
		if (
			uri.scheme === "" ||
			(uri.scheme === "file" && isSymbolLike(uri.fragment))
		) {
			return { name: uri.fragment, uri: uri.fsPath };
		}
	} catch {
		if (isSymbolLike(rawSymbol)) {
			return { name: rawSymbol };
		}
	}
}
*/

/*
class SymbolProcessor implements DocumentProcessor {
	private symbolDocs: Map<SectionId, SymbolDoc[]> = new Map();

	private extractSymbols(section: Section): SymbolDoc[] {
		const output = [];
		if (isSymbolLike(cleanTitle)) {
			const symbol = parseSymbol(cleanTitle);
			if (symbol) {
				output.push({
					symbol: symbol,
					relation: DocRelation.Title,
				});
			}
		}
		for (const child of section.children) {
			switch (child.kind) {
*/
				/*
				case "link": {
					const symbol = parseSymbol(child.uri);
					if (symbol) {
						output.push({
							symbol: symbol,
							relation: DocRelation.Link,
						});
					}
                    break;
				}
				case "title": {
					const symbol = parseSymbol(child.content);
					if (symbol) {
						output.push({
							symbol: symbol,
							relation: DocRelation.Title,
						});
					}
				}
				*/
/*
			}
		}
		return output;
	}
}

class SymbolCommentProcessor extends SymbolProcessor {}
*/

/*
function isSymbolLike(text: string): boolean {
	return text.trim().search(new RegExp("[ \t{}\\\\'\"]")) === -1;
}
*/