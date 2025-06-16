import { DocumentationBackend } from "./interface";
import { LocalFilesBackend } from "./localFiles";
export const backends: Array<DocumentationBackend> = [new LocalFilesBackend()];