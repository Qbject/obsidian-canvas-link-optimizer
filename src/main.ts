import { around } from "monkey-around";
import { Plugin, Canvas, CanvasView, LinkNodeConstructor } from "obsidian";
import { NativeImage } from "electron";
import { createHash } from "crypto";
import { sleep } from "./util";

export default class CanvasLinkOptimizerPlugin extends Plugin {
	name = "Canvas Link Optimizer";

	async onload() {
		this.registerEvent(this.app.workspace.on(`${this.manifest.id}:patched-canvas`, () => {
			this.reloadActiveCanvasViews();
		}));

		this.app.vault.adapter.mkdir(this.getCacheDir());

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
		this.app.workspace.getLeavesOfType("canvas").map((leaf) =>
			leaf.rebuildView());
	};

	log(msg: any, debug: boolean = false) {
		debug ?
			console.debug(`[${this.name}]`, msg) :
			console.log(`[${this.name}]`, msg);
	}

	tryPatchLinkNode(): boolean {
		const canvasView = this.app.workspace.getLeavesOfType("canvas")
			.first()?.view;
		if (!canvasView) return false;

		const canvas: Canvas = (canvasView as CanvasView)?.canvas;
		if (!canvas) return false;

		const linkNodeConstructor = this.retrieveLinkNodeConstructor(canvas);
		this.patchLinkNode(linkNodeConstructor);
		return true;
	}

	patchLinkNode(constructor: LinkNodeConstructor): boolean {
		const thisPlugin = this;
		const uninstaller = around(constructor.prototype, {
			initialize: (next: any) =>
				function (...args: any[]) {
					this._initializing = true;
					const result = next.call(this, ...args);
					this._initializing = false;

					const revealWebview = () => {
						this.alwaysKeepLoaded = true;
						this._perviewImageEl?.remove?.();
						this.recreateFrame();
					}

					const thumbnailPath = thisPlugin.getLinkCachePath(this.url, "thumbnail.jpg");
					const metadataPath = thisPlugin.getLinkCachePath(this.url, "metadata.json");

					(async () => {
						const [thumbnailExists, metadataExists] = await Promise.all([
							thisPlugin.app.vault.exists(thumbnailPath),
							thisPlugin.app.vault.exists(metadataPath)
						]);
						if (!thumbnailExists || !metadataExists) {
							// url isn't cached, loading webview
							this.recreateFrame();
							return;
						}

						this.alwaysKeepLoaded = false;

						// setting cached title
						const metadataRaw = await thisPlugin.app.vault.adapter.read(metadataPath);
						const metadata = JSON.parse(metadataRaw);
						this.updateNodeLabel(metadata.title);

						this._perviewImageEl = this.contentEl.doc.createElement("img");
						this.contentEl.append(this._perviewImageEl);
						this._perviewImageEl.classList.add("link-thumbnail");
						this._perviewImageEl.alt = "Webpage thumbnail";

						// displaying cached thumbnail
						this._perviewImageEl.src = thisPlugin.app.vault.adapter
							.getResourcePath(thumbnailPath);

						this._perviewImageEl.addEventListener("click", () => {
							this.alwaysKeepLoaded = true;
							this._perviewImageEl?.remove?.();
							this.recreateFrame();
						});
					})();

					return result;
				},

			recreateFrame: (next: any) =>
				function (...args: any[]) {
					if (this._initializing) return null;

					const result = next.call(this, ...args);

					// wont trigger on mobile
					if (this.frameEl?.tagName === "WEBVIEW") {
						const onFrameLoaded = async () => {
							this.frameEl.removeEventListener("did-frame-finish-load", onFrameLoaded);

							// some pages aren't fully initialized at this moment, so waiting a bit more
							await sleep(1000);

							// saving page title
							const metadataPath = thisPlugin.getLinkCachePath(this.url, "metadata.json");
							this.app.vault.adapter.write(metadataPath, JSON.stringify({
								title: this.frameEl.getTitle()
							}));

							// saving captured thumbnail
							const img: NativeImage = await this.frameEl.capturePage();
							const thumbnailPath = thisPlugin.getLinkCachePath(this.url, "thumbnail.jpg");
							this.app.vault.adapter.writeBinary(thumbnailPath, img.toJPEG(100));

							thisPlugin.log(`Cached link ${this.url}`);
						}

						this.frameEl.addEventListener("did-frame-finish-load", onFrameLoaded);
					}

					return result;
				}
		});
		this.register(uninstaller);

		thisPlugin.log("Canvas patched successfully");
		thisPlugin.app.workspace.trigger(`${thisPlugin.manifest.id}:patched-canvas`);
		return true;
	};

	retrieveLinkNodeConstructor(canvasInstance: Canvas): LinkNodeConstructor {
		// dummy canvas allows calling any method without raising errors
		const dummyCanvasInstance = new Proxy({}, { get: () => () => { } });
		const dummyNodeParams = {
			pos: { x: 0, y: 0 },
			size: { width: 0, height: 0 },
			position: "center",
			url: "",
			save: false,
			focus: false
		}

		const dummyLinkNode = canvasInstance.createLinkNode.call(
			dummyCanvasInstance, dummyNodeParams);
		return dummyLinkNode.constructor;
	}

	getPluginDir(): string {
		return `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}

	getCacheDir(): string {
		return `${this.getPluginDir()}/data/linkCache`;
	}

	getLinkCachePath(url: string, suffix: string): string {
		const linkHash = createHash('sha256').update(url).digest("hex");
		return `${this.getCacheDir()}/${linkHash.slice(0, 16)}.${suffix}`;
	}
}