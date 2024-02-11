import { App } from "obsidian";

declare module "obsidian" {
	interface WorkspaceLeaf {
		rebuildView(): void;
	}

	interface Workspace {
		trigger(
			name: string,
		): void;

		on(
			name: string,
			cb: () => any,
		): EventRef;
	}

	interface Canvas {
		initialize(...args: any[]): any;
		recreateFrame(...args: any[]): any;
		createLinkNode(...args: any[]): LinkNode;
	}

	interface CanvasView extends View {
		canvas: Canvas;
	}

	interface LinkNode {
		url: string;
		constructor: LinkNodeConstructor;
	}

	interface LinkNodeConstructor {
		prototype: any;
	}

	interface Vault {
		exists(path: string): Promise<boolean>;
	}
}