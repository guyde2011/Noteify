import { Backend } from "./interface";
import { LocalFilesBackend } from "./localBackend";
import { ObsidianBackend } from "./obsidianBackend";
export default function get(): Array<Backend> {
    return [new ObsidianBackend(), new LocalFilesBackend()];
}