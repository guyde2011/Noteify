import { App, Editor, Modal, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import * as net from "node:net";
import {getServerSocketPath} from "./src/util";
import {State} from "./src/State";
import Client from "src/Client";

// Remember to rename these classes and interfaces!

interface RPCPluginSettings {
    mySetting: string;
}

const DEFAULT_SETTINGS: RPCPluginSettings = {
    mySetting: 'default'
}

export default class RPCPlugin extends Plugin {
    settings: RPCPluginSettings;
    ipcServer: net.Server | null = null;
    ipcServerError: Error | null = null;
    statusBarItem: HTMLElement | null = null;
    state: State;

    /**
     * Call after assigning to ipcServer or ipcServerError
     */
    updateStatusText(): void {
        const set = (t: string) => this.statusBarItem?.setText(t);
        if (this.ipcServer !== null) {
            set("Noteify running");
        } else {
            set("Noteify is down");
        }
    }

    /**
     * Gets full status of the plugin, to show in a modal
     */
    getFullStatus(): string {
        const lines: string[] = [];

        if (this.ipcServer !== null) {
            lines.push("IPC server is running.");
        } else {
            if (this.ipcServerError !== null) {
                lines.push(`IPC server is down due to an error: ${JSON.stringify(this.ipcServerError.toString())}.`);
            } else {
                lines.push("IPC server is down due to an unknown error.");
            }
        }

        return lines.join("\n");
    }

    startIpcServer(): void {
        const sockPath = getServerSocketPath();
        const server = net.createServer({ allowHalfOpen: false }, Client.newConnection.bind(null, this.state))
        this.ipcServer = server;
        this.ipcServerError = null;
        this.updateStatusText();
        // there may be an error while opening
        server.on("error", (err: Error) => {
            console.error(`Obsidian RPC: IPC server got an error when trying to listen: ${err}.`);
            this.ipcServer = null;
            this.ipcServerError = err;
            this.updateStatusText();
        })
        // start listening
        server.listen(sockPath);
    }

    closeIpcServer(): void {
        if (this.ipcServer !== null) {
            this.ipcServer.close();
            this.ipcServer = null;
            this.ipcServerError = null;
        }
    }

    async onload() {
        await this.loadSettings();

        // Creates a status bar at the bottom, where we can set text.
        this.statusBarItem = this.addStatusBarItem();

        // Track all markdown files
        const app = this.app;
        const vault = this.app.vault;
        this.state = new State(vault, {
            goTo(filename, line, column) {
                console.log("goTo", filename, line, column);
                const file = vault.getAbstractFileByPath(filename);
                if (!(file instanceof TFile)) {
                    console.log("goTo: not a file");
                    return;
                }
                const tab = app.workspace.getLeaf();
                tab.openFile(file);
                if (!tab.view || !("editor" in tab.view)) {
                    console.log("goTo: no editor");
                    return;
                }
                (tab.view.editor as Editor).setCursor({ line: line, ch: column });
            },
        });
        this.registerEvent(vault.on("create", this.state.vaultOnCreateOrModify.bind(this.state)));
        this.registerEvent(vault.on("modify", this.state.vaultOnCreateOrModify.bind(this.state)));
        this.registerEvent(vault.on("delete", this.state.vaultOnDelete.bind(this.state)));
        this.registerEvent(vault.on("rename", this.state.vaultOnRename.bind(this.state)));
        this.registerEvent(this.app.workspace.on("quit", _ => {
            this.closeIpcServer();
        }));

        // Initialize with all existing files
        for (const file of vault.getFiles()) {
            this.state.vaultOnCreateOrModify(file);
        }

        // Start listening over a unix domain socket
        this.startIpcServer();

        // This adds a simple command that can show IPC status
        this.addCommand({
            id: 'show-obsidian-rpc-status',
            name: 'Show plugin status',
            callback: () => {
                new StatusModal(this, this.app).open();
            }
        });

        /*
        // This adds an editor command that can perform some operation on the current editor instance
        this.addCommand({
            id: 'sample-editor-command',
            name: 'Sample editor command',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                console.log(editor.getSelection());
                editor.replaceSelection('Sample Editor Command');
            }
        });
        */
        /*
        // This creates an icon in the left ribbon.
        const ribbonIconEl = this.addRibbonIcon('dice', 'Obsidian RPC', (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            new Notice('This is a notice!');
        });
        // Perform additional things with the ribbon
        ribbonIconEl.addClass('my-plugin-ribbon-class');
        */
        /*
        // This adds a complex command that can check whether the current state of the app allows execution of the command
        this.addCommand({
            id: 'open-sample-modal-complex',
            name: 'Open sample modal (complex)',
            checkCallback: (checking: boolean) => {
                // Conditions to check
                const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (markdownView) {
                    // If checking is true, we're simply "checking" if the command can be run.
                    // If checking is false, then we want to actually perform the operation.
                    if (!checking) {
                        new StatusModal(this, this.app).open();
                    }

                    // This command will only show up in Command Palette when the check function returns true
                    return true;
                }
            }
        });
        */

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new RPCSettingTab(this.app, this));

        /*
        // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
        // Using this function will automatically remove the event listener when this plugin is disabled.
        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            console.log('click', evt);
        });

        // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
        this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
        */
    }

    onunload() {
        this.closeIpcServer();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class StatusModal extends Modal {
    constructor(public plugin: RPCPlugin, app: App) {
        super(app);
    }

    onOpen() {
        const {plugin, contentEl} = this;
        contentEl.setText(plugin.getFullStatus());
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class RPCSettingTab extends PluginSettingTab {
    plugin: RPCPlugin;

    constructor(app: App, plugin: RPCPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Setting #1')
            .setDesc('It\'s a secret')
            .addText(text => text
                .setPlaceholder('Enter your secret')
                .setValue(this.plugin.settings.mySetting)
                .onChange(async (value) => {
                    this.plugin.settings.mySetting = value;
                    await this.plugin.saveSettings();
                }));
    }
}
