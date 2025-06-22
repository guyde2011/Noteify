import { Backend } from "./interface";
import { LocalFilesBackend } from "./localBackend";
export default function get(): Backend[] {
    return [new LocalFilesBackend()];
}