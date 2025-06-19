import { Backend } from "./interface";
import { LocalFilesBackend } from "./localFiles";
export default function get(): Array<Backend> {
    return [new LocalFilesBackend()];
}