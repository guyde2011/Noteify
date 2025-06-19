import { Backend } from "./interface";
import { LocalFilesBackend } from "./localBackend";
export default function get(): Array<Backend> {
    return [new LocalFilesBackend()];
}