import { App } from "obsidian";

declare module "obsidian" {
	interface WorkspaceLeaf {
		rebuildView(): void;
	}

	interface Workspace {
		trigger(name: string): void;

		on(name: string, cb: () => unknown): EventRef;
	}

	interface Canvas {
		initialize(...args: unknown[]): unknown;
		recreateFrame(...args: unknown[]): unknown;
		createLinkNode(...args: unknown[]): LinkNode;
	}

	interface CanvasView extends View {
		canvas: Canvas;
	}

	interface LinkNode {
		url: string;
		constructor: LinkNodeConstructor;
	}

	interface LinkNodeConstructor {
		prototype: (...args: unknown[]) => unknown;
	}

	interface Vault {
		exists(path: string): Promise<boolean>;
	}

	interface CanvasNodeData {
		id: string;
	}
}
