import { DocumentationBackend } from "./interface";
import { LocalFilesBackend } from "./localFiles";
/**
 * @returns instances of each of the Backend classes, ordered by precedence (the first is the most important)
 */
export default function get(): Array<DocumentationBackend> {
    return [new LocalFilesBackend()];
}