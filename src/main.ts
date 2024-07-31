import { around } from "monkey-around";
import {
	Plugin,
	Canvas,
	CanvasView,
	LinkNodeConstructor,
	debounce,
	Notice,
	CanvasNodeData,
} from "obsidian";
import { NativeImage } from "electron";

export default class CanvasLinkOptimizerPlugin extends Plugin {
	name = "Canvas Link Optimizer";
	cacheDir = `${this.manifest.dir}/data/linkCache`;

	async onload() {
		this.addCommand({
			id: "cleanup-unused-thumbnails",
			name: "Cleanup unused thumbnails",
			callback: () => this.cleanupThumbnails(),
		});

		this.registerEvent(
			this.app.workspace.on(`${this.manifest.id}:patched-canvas`, () => {
				this.reloadActiveCanvasViews();
			})
		);

		this.app.vault.adapter.mkdir(this.cacheDir);

		this.app.workspace.onLayoutReady(() => {
			if (!this.tryPatchLinkNode()) {
				const evt = this.app.workspace.on("layout-change", () => {
					this.tryPatchLinkNode() && this.app.workspace.offref(evt);
				});
				this.registerEvent(evt);
			}
		});

		this.log("Plugin loaded");
	}

	onunload() {
		this.log("Unloading plugin");
		this.reloadActiveCanvasViews();
	}

	reloadActiveCanvasViews() {
		this.app.workspace
			.getLeavesOfType("canvas")
			.map((leaf) => leaf.rebuildView());
	}

	log(msg: unknown, debug = false) {
		debug
			? console.debug(`[${this.name}]`, msg)
			: console.log(`[${this.name}]`, msg);
	}

	tryPatchLinkNode(): boolean {
		const canvasView = this.app.workspace
			.getLeavesOfType("canvas")
			.first()?.view;
		if (!canvasView) return false;

		const canvas: Canvas = (canvasView as CanvasView)?.canvas;
		if (!canvas) return false;

		const linkNodeConstructor = this.retrieveLinkNodeConstructor(canvas);
		this.patchLinkNode(linkNodeConstructor);
		return true;
	}

	patchLinkNode(constructor: LinkNodeConstructor): boolean {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const thisPlugin = this;
		const uninstaller = around(constructor.prototype, {
			_saveThumbnail: () =>
				async function () {
					if (!this.frameEl) return;

					thisPlugin.log(`Saving thumbnail for ${this.url}`);
					const img: NativeImage = await this.frameEl.capturePage();
					this.app.vault.adapter.writeBinary(
						this._getThumbnailPath(),
						img.toJPEG(100)
					);
				},
			_getThumbnailPath: () =>
				function () {
					return `${thisPlugin.cacheDir}/${this.id}.thumbnail.jpg`;
				},
			_getMetadataPath: () =>
				function () {
					return `${thisPlugin.cacheDir}/${this.id}.metadata.json`;
				},
			initialize: (next: (...args: unknown[]) => unknown) =>
				function (...args: unknown[]) {
					this._initializing = true;
					const result = next.call(this, ...args);
					this._initializing = false;

					// adding resize handler
					const saveThumbnail = debounce(
						() => this._saveThumbnail(),
						500
					);
					const resizeObserver = new MutationObserver(
						async (mutationList) => {
							for (const mutation of mutationList) {
								if (
									mutation.type !== "attributes" ||
									mutation.attributeName !== "style"
								)
									continue;

								const target = mutation.target as HTMLElement;
								const newWidth = target.style.width;
								const newHeight = target.style.height;

								const oldValue = mutation.oldValue || "";
								const oldWidthMatch = oldValue.match(
									/width:\s*([^;]+)(;|$)/
								);
								const oldHeightMatch = oldValue.match(
									/height:\s*([^;]+)(;|$)/
								);
								const oldWidth = oldWidthMatch
									? oldWidthMatch[1].trim()
									: "";
								const oldHeight = oldHeightMatch
									? oldHeightMatch[1].trim()
									: "";

								if (
									!oldWidth ||
									!oldHeight ||
									!newWidth ||
									!newHeight
								)
									return;
								if (
									newWidth === oldWidth &&
									newHeight === oldHeight
								)
									return;
								saveThumbnail();
							}
						}
					);

					const config = {
						attributes: true,
						attributeOldValue: true,
						attributeFilter: ["style"],
					};
					resizeObserver.observe(this.nodeEl, config);

					// displaying thumbnail
					(async () => {
						const revealWebview = () => {
							this.alwaysKeepLoaded = true;
							this._perviewImageEl?.remove?.();
							this.recreateFrame();
						};

						const [thumbnailExists, metadataExists] =
							await Promise.all([
								thisPlugin.app.vault.exists(
									this._getThumbnailPath()
								),
								thisPlugin.app.vault.exists(
									this._getMetadataPath()
								),
							]);
						if (!thumbnailExists || !metadataExists) {
							// url isn't cached, loading webview
							this.recreateFrame();
							return;
						}

						this.alwaysKeepLoaded = false;

						// setting cached title
						const metadataRaw =
							await thisPlugin.app.vault.adapter.read(
								this._getMetadataPath()
							);
						const metadata = JSON.parse(metadataRaw);
						this.updateNodeLabel(metadata.title);

						this._perviewImageEl =
							this.contentEl.doc.createElement("img");
						this.contentEl.append(this._perviewImageEl);
						this._perviewImageEl.classList.add("link-thumbnail");
						this._perviewImageEl.alt = "Webpage thumbnail";

						// displaying cached thumbnail
						this._perviewImageEl.src =
							thisPlugin.app.vault.adapter.getResourcePath(
								this._getThumbnailPath()
							);

						this._perviewImageEl.addEventListener(
							"click",
							revealWebview
						);
						this._perviewImageEl.addEventListener(
							"error",
							revealWebview
						);
					})();

					return result;
				},

			recreateFrame: (next: (...args: unknown[]) => unknown) =>
				function (...args: unknown[]) {
					if (this._initializing) return null;

					const result = next.call(this, ...args);

					// wont trigger on mobile
					if (this.frameEl?.tagName === "WEBVIEW") {
						const onFrameLoaded = async () => {
							this.frameEl.removeEventListener(
								"did-frame-finish-load",
								onFrameLoaded
							);

							// some pages aren't fully initialized at this moment, so waiting a bit more
							await sleep(1000);

							// saving page title
							const metadataPath = this._getMetadataPath();
							this.app.vault.adapter.write(
								metadataPath,
								JSON.stringify({
									title: this.frameEl.getTitle(),
								})
							);

							await this._saveThumbnail();
							thisPlugin.log(`Cached link ${this.url}`);
						};

						this.frameEl.addEventListener(
							"did-frame-finish-load",
							onFrameLoaded
						);
					}

					return result;
				},
		});
		this.register(uninstaller);

		thisPlugin.log("Canvas patched successfully");
		thisPlugin.app.workspace.trigger(
			`${thisPlugin.manifest.id}:patched-canvas`
		);
		return true;
	}

	retrieveLinkNodeConstructor(canvasInstance: Canvas): LinkNodeConstructor {
		// dummy canvas allows calling any method without raising errors
		const dummyCanvasInstance = new Proxy({}, { get: () => () => {} });
		const dummyNodeParams = {
			pos: { x: 0, y: 0 },
			size: { width: 0, height: 0 },
			position: "center",
			url: "",
			save: false,
			focus: false,
		};

		const dummyLinkNode = canvasInstance.createLinkNode.call(
			dummyCanvasInstance,
			dummyNodeParams
		);
		return dummyLinkNode.constructor;
	}

	async cleanupThumbnails() {
		const thumbnails = await this.app.vault.adapter.list(this.cacheDir);

		const thumbnailFiles = thumbnails.files.filter((file) =>
			file.endsWith(".thumbnail.jpg")
		);

		// Extract node IDs from file names
		const nodeIds = thumbnailFiles
			.map((file) => {
				const match = file.match(/([^/]+)\.thumbnail\.jpg$/);
				return match ? match[1] : undefined;
			})
			.filter((nodeId): nodeId is string => nodeId !== undefined);

		// Get all canvas files in the vault
		const allFiles = this.app.vault.getFiles();
		const canvasFiles = allFiles.filter((file) =>
			file.path.endsWith(".canvas")
		);

		// Collect all used node IDs
		const usedNodeIds = new Set<string>();

		for (const canvasFile of canvasFiles) {
			const content = await this.app.vault.read(canvasFile);
			const nodes = this.extractNodeIdsFromCanvas(content);
			nodes.forEach((nodeId) => usedNodeIds.add(nodeId));
		}

		// Determine unused node IDs
		const unusedNodeIds = nodeIds.filter(
			(nodeId) => !usedNodeIds.has(nodeId)
		);

		// Delete unused thumbnail and metadata files
		for (const nodeId of unusedNodeIds) {
			this.log("Removing cache for missing node " + nodeId);

			const thumbnailFile = `${this.cacheDir}/${nodeId}.thumbnail.jpg`;
			const metadataFile = `${this.cacheDir}/${nodeId}.metadata.json`;

			const removeFile = async (path: string) => {
				if (await this.app.vault.adapter.exists(path)) {
					await this.app.vault.adapter.remove(path);
				}
			};

			await removeFile(thumbnailFile);
			await removeFile(metadataFile);
		}

		new Notice(`${unusedNodeIds.length} Unused thumbnails cleaned up!`);
	}

	extractNodeIdsFromCanvas(content: string): Set<string> {
		const canvas = JSON.parse(content);
		return (canvas.nodes || []).map((node: CanvasNodeData) => node.id);
	}
}
