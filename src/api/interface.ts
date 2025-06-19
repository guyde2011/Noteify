import { Uri } from "vscode";
import * as doc from "./document";

export enum BackendStatus {
	Success = 0,
	ConnectionClosed = 1,
	Unsupported = 2,
	NotFound = 3,
}

export namespace BackendStatus {
	export function toString(s: BackendStatus): string {
		switch (s) {
			case BackendStatus.Success:
				return "Success";
			case BackendStatus.ConnectionClosed:
				return "Connection Closed";
			case BackendStatus.Unsupported:
				return "Unsupported";
			case BackendStatus.NotFound:
				return "Not Found";
			default:
				return "Unrecognized error";
		}
	}
}

export type BackendResult<T> =
	| {
			status: "success";
			value: T;
	  }
	| {
			status: "error";
			error: BackendStatus;
	  };

export namespace BackendResult {
	export function success<T>(
		value: T
	): BackendResult<T> & { status: "success" } {
		return {
			status: "success",
			value: value,
		};
	}

	export function error(
		status: BackendStatus
	): BackendResult<never> & { status: "error" } {
		return {
			status: "error",
			error: status,
		};
	}
}

export interface Backend {
	/**
	 * init checks whether the backend is relevant in this universe.
	 * It is also allowed to initialize some very rudamentary empty state, like a database of open workspaces. This state must not be complicated enough to require a "dispose".
	 *
	 * init is intended to complete quickly. It should be a very O(1) operation.
	 *
	 * Good usage examples of it include:
	 * - Look for binaries relevant to this backend
	 * - Check whether this backend's socket is open
	 */
	init(): Promise<void>;

	/**
	 * This field should be set by init(). It represents whether this documentation backend is valid for use.
	 * Do not call init() if this is true. Conversely, do not call open() and other functions if this is false.
	 */
	get initialized(): boolean;

	/**
	 * Unique user-facing name of this documentation backend.
	 */
	get name(): string;

	/**
	 * Opening a documentation backend:
	 *  - Returns "NotFound" if the backend does not exist.
	 *  - Is encouraged to build an index of docmentation objects if necessary.
	 * @param workspaceUri By default, should come from "workspaceFile", and may be stored as an identifier for this worksapce within the backend.
	 * It could also be `noteify://user_defined_name`, to make the documentation portable between users and machines.
	 */
	open(workspaceUri: Uri): Promise<BackendResult<BackendInstance>>;
}

export type BackendFeatures = {
	// Sets the contents of a section
	readonly setSection?: (
		sectionId: doc.SectionId,
		section: doc.Section
	) => Promise<BackendStatus>;

	// Creates a new Documentation section, and returns its id
	readonly createSection?: () => Promise<doc.SectionId>;

	// Deletes the given documentation nsection
	readonly deleteSection?: (
		sectionId: doc.SectionId
	) => Promise<BackendStatus>;

	// A jump-to request for an external editor
	readonly revealSection?: (
		sectionId: doc.SectionId
	) => Promise<BackendStatus>;
};

/**
 * An instance for managing the documentation of a project.
 *
 * Used to interact with the existing documentation, as well for any other
 * documentation tool-specific features.
 */
export interface BackendInstance {
	readonly features: BackendFeatures;

	properties: {
		// TODO: Allow dynamic via line.
		/**
		 * Comment docs show this name to identify the backend
		 * Should be of the pattern: "Noteify via ..."
		 */
		viaName: string;
	};

	/**
	 * Closes any outgoing connection to the backend.
	 * It must complete synchronously, because the workspace
	 * may be reopened immediately after calling dispose().
	 */
	dispose(): void;
}
