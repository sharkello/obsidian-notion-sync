import { App, PluginSettingTab, Setting } from "obsidian";
import type NotionSyncPlugin from "../main";
import { SyncMode } from "../types";

/**
 * Settings UI tab for the Notion Sync plugin.
 */
export class NotionSyncSettingTab extends PluginSettingTab {
  plugin: NotionSyncPlugin;

  constructor(app: App, plugin: NotionSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Notion Sync Settings" });

    // ── Connection ────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Connection" });

    new Setting(containerEl)
      .setName("Notion API Token")
      .setDesc(
        "Your Notion integration secret token. " +
        "Create one at notion.so/my-integrations."
      )
      .addText((text) =>
        text
          .setPlaceholder("secret_...")
          .setValue(this.plugin.settings.notionToken)
          .onChange(async (value) => {
            this.plugin.settings.notionToken = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Root Notion Page ID")
      .setDesc(
        "The ID of the Notion page that will serve as the vault root. " +
        "Find it in the page URL: notion.so/Page-Title-<PAGE_ID>."
      )
      .addText((text) =>
        text
          .setPlaceholder("abc123...")
          .setValue(this.plugin.settings.rootPageId)
          .onChange(async (value) => {
            this.plugin.settings.rootPageId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test Connection")
      .setDesc("Verify that the plugin can connect to Notion.")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const ok = await this.plugin.testConnection();
            button.setButtonText(ok ? "Connected!" : "Failed");
          } catch {
            button.setButtonText("Failed");
          }
          setTimeout(() => {
            button.setButtonText("Test");
            button.setDisabled(false);
          }, 2000);
        })
      );

    // ── Sync Mode ─────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Sync Mode" });

    new Setting(containerEl)
      .setName("Sync Mode")
      .setDesc("When to automatically sync files to Notion.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption(SyncMode.Manual, "Manual Only")
          .addOption(SyncMode.CurrentFile, "Current File on Command")
          .addOption(SyncMode.OnSave, "Auto Sync on Save")
          .addOption(SyncMode.Scheduled, "Scheduled Interval")
          .setValue(this.plugin.settings.syncMode)
          .onChange(async (value) => {
            this.plugin.settings.syncMode = value as SyncMode;
            await this.plugin.saveSettings();
            this.plugin.configureSyncMode();
            this.display(); // Refresh to show/hide interval setting
          })
      );

    if (this.plugin.settings.syncMode === SyncMode.Scheduled) {
      new Setting(containerEl)
        .setName("Sync Interval (minutes)")
        .setDesc("How often to run automatic sync.")
        .addSlider((slider) =>
          slider
            .setLimits(5, 120, 5)
            .setValue(this.plugin.settings.scheduledIntervalMinutes)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.scheduledIntervalMinutes = value;
              await this.plugin.saveSettings();
              this.plugin.configureSyncMode();
            })
        );
    }

    // ── Content Options ───────────────────────────────────────

    containerEl.createEl("h3", { text: "Content" });

    new Setting(containerEl)
      .setName("Sync Attachments")
      .setDesc(
        "Include images, PDFs, and other embedded files. " +
        "Requires an upload endpoint for local files."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncAttachments)
          .onChange(async (value) => {
            this.plugin.settings.syncAttachments = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.syncAttachments) {
      new Setting(containerEl)
        .setName("Attachment Upload URL")
        .setDesc(
          "POST endpoint for uploading local files. " +
          "Should accept multipart/form-data and return { url: string }. " +
          "Leave empty to show placeholders for local attachments."
        )
        .addText((text) =>
          text
            .setPlaceholder("https://your-upload-service.com/upload")
            .setValue(this.plugin.settings.attachmentUploadUrl)
            .onChange(async (value) => {
              this.plugin.settings.attachmentUploadUrl = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Sync Metadata")
      .setDesc("Include YAML frontmatter as a metadata block in Notion pages.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncMetadata)
          .onChange(async (value) => {
            this.plugin.settings.syncMetadata = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Download Images on Pull")
      .setDesc(
        "When pulling from Notion, download images to a local _attachments folder " +
        "and replace URLs with Obsidian ![[filename]] embeds."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.downloadImages)
          .onChange(async (value) => {
            this.plugin.settings.downloadImages = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Status ────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Status" });

    const statusEl = containerEl.createDiv({ cls: "notion-sync-status" });
    statusEl.createEl("p", {
      text: `Synced files: ${this.plugin.stateManager.syncedFileCount}`,
    });
    statusEl.createEl("p", {
      text: `Synced folders: ${this.plugin.stateManager.syncedFolderCount}`,
    });

    const lastSync = this.plugin.stateManager.lastFullSync;
    if (lastSync > 0) {
      statusEl.createEl("p", {
        text: `Last full sync: ${new Date(lastSync).toLocaleString()}`,
      });
    }

    // ── Danger Zone ───────────────────────────────────────────

    containerEl.createEl("h3", { text: "Danger Zone" });

    new Setting(containerEl)
      .setName("Reset Sync State")
      .setDesc(
        "Clear all sync mappings. The next sync will treat everything as new. " +
        "Existing Notion pages will NOT be deleted."
      )
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.stateManager.reset();
            await this.plugin.saveState();
            this.display();
          })
      );
  }
}
