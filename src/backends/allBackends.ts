import { DocumentationBackend } from "./interface";
import { LocalFilesBackend } from "./localFiles";
export default function get(): Array<DocumentationBackend> {
    return [new LocalFilesBackend()];
}