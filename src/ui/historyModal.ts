import { App, Modal } from "obsidian";
import type NotionSyncPlugin from "../main";
import type { SyncHistoryEntry } from "../types";

/**
 * Modal that displays sync history with rollback support.
 */
export class HistoryModal extends Modal {
  private plugin: NotionSyncPlugin;

  constructor(app: App, plugin: NotionSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("notion-sync-history-modal");

    contentEl.createEl("h2", { text: "Sync history" });

    const entries = this.plugin.stateManager.getHistory().slice(0, 50);

    if (entries.length === 0) {
      contentEl.createEl("p", {
        text: "No sync history yet.",
        cls: "notion-sync-history-empty",
      });
      return;
    }

    const listEl = contentEl.createDiv({ cls: "notion-sync-history-list" });

    for (const entry of entries) {
      this.renderEntry(listEl, entry);
    }
  }

  private renderEntry(container: HTMLElement, entry: SyncHistoryEntry): void {
    const row = container.createDiv({ cls: "notion-sync-history-entry" });

    // Icon
    const iconEl = row.createDiv({ cls: "notion-sync-history-icon" });
    const iconMap: Record<string, string> = {
      push: "↑",
      pull: "↓",
      "pull-new": "★",
    };
    iconEl.setText(iconMap[entry.operation] || "•");
    iconEl.addClass(`notion-sync-history-op-${entry.operation}`);

    // Info
    const infoEl = row.createDiv({ cls: "notion-sync-history-info" });

    const nameEl = infoEl.createDiv({ cls: "notion-sync-history-filename" });
    nameEl.setText(entry.fileName);

    const metaEl = infoEl.createDiv({ cls: "notion-sync-history-meta" });
    const opLabels: Record<string, string> = {
      push: "Pushed to Notion",
      pull: "Pulled from Notion",
      "pull-new": "New page pulled",
    };
    const opLabel = opLabels[entry.operation] || entry.operation;
    const timeAgo = this.formatTimeAgo(entry.timestamp);
    metaEl.setText(`${opLabel} · ${timeAgo}`);

    // Rollback button (only for pull entries that have a snapshot)
    if (entry.operation === "pull" && entry.snapshot) {
      const rollbackBtn = row.createEl("button", {
        text: "↩ rollback",
        cls: "notion-sync-history-rollback-btn",
      });
      rollbackBtn.addEventListener("click", () => {
        void (async () => {
          rollbackBtn.setAttr("disabled", "true");
          rollbackBtn.setText("Rolling back...");
          try {
            await this.plugin.rollbackFile(entry.id);
            rollbackBtn.setText("Done");
          } catch {
            rollbackBtn.setText("Failed");
          }
        })();
      });
    }
  }

  private formatTimeAgo(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
