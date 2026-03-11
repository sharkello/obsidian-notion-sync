# Notion Sync for Obsidian

Synchronize your entire Obsidian vault to Notion — preserving folder hierarchy, markdown formatting, internal links, frontmatter metadata, and attachments.

---

## Features

- **Full vault sync** — mirrors your complete vault structure to Notion in a single command
- **Incremental sync** — only pushes files that have changed since the last sync
- **On-save sync** — automatically syncs a note to Notion the moment you save it
- **Scheduled sync** — runs sync automatically on a configurable interval
- **Folder hierarchy** — recreates your folder tree as nested Notion pages
- **Markdown conversion** — headings, bold, italic, code, tables, blockquotes, lists, dividers, and more all convert to native Notion blocks
- **Frontmatter metadata** — YAML frontmatter is parsed and synced as Notion page properties
- **Internal link resolution** — `[[wikilinks]]` are resolved to their synced Notion page URLs
- **Attachment support** — images and file embeds (`![[file.png]]`) can be uploaded to Notion via a configurable upload endpoint
- **Sync log** — an in-app log modal shows every sync operation with timestamps and status
- **Connection test** — verify your Notion API token with a single click before syncing
- **Abort support** — cancel an in-progress sync at any time

---

## Requirements

- Obsidian **1.4.0** or later
- A [Notion integration](https://www.notion.so/my-integrations) with access to your target page
- Desktop only (not supported on mobile)

---

## Setup

### 1. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration**, give it a name, and select your workspace
3. Copy the **Internal Integration Secret** — this is your API token

### 2. Share Your Root Notion Page

1. Open the Notion page you want to use as the vault root
2. Click **Share** → **Invite** → search for your integration and add it
3. Copy the page ID from the URL:  
   `https://notion.so/Your-Page-Title-`**`abc123def456...`**

### 3. Configure the Plugin

Open **Settings → Notion Sync** and fill in:

| Setting | Description |
|---|---|
| **Notion API Token** | Your integration secret (`secret_...`) |
| **Root Notion Page ID** | The page ID from step 2 |
| **Sync Mode** | Manual / On Save / Scheduled / Current File |
| **Sync Attachments** | Upload images and file embeds |
| **Sync Metadata** | Push YAML frontmatter as page properties |
| **Sync Interval** | How often to auto-sync (minutes, scheduled mode only) |
| **Attachment Upload URL** | Optional external endpoint for file uploads |

Click **Test Connection** to verify everything is working.

---

## Sync Modes

| Mode | Behavior |
|---|---|
| **Manual** | Only syncs when you run a command |
| **On Save** | Syncs the current file every time you save |
| **Scheduled** | Syncs the entire vault at a set interval |
| **Current File** | Syncs only the currently open file on demand |

---

## Commands

All commands are available via the Command Palette (`Cmd/Ctrl + P`):

| Command | Description |
|---|---|
| **Sync entire vault to Notion** | Full sync of all notes and folders |
| **Sync current note to Notion** | Push only the currently open note |
| **Sync changed files to Notion** | Incremental sync — only changed files |
| **Rebuild Notion hierarchy** | Re-create the folder structure in Notion without re-syncing content |
| **Open sync log** | View a detailed log of all sync operations |

---

## Markdown Support

The following Obsidian/Markdown elements are converted to native Notion blocks:

- Headings (`#`, `##`, `###`)
- Paragraphs
- **Bold**, *italic*, ~~strikethrough~~, `inline code`
- Bulleted and numbered lists
- To-do checkboxes (`- [ ]` / `- [x]`)
- Block quotes (`>`)
- Code blocks (fenced with language hint)
- Tables
- Horizontal dividers (`---`)
- Embedded images and files (`![[...]]`)
- Internal wikilinks (`[[Note Name]]`) resolved to Notion URLs

---

## Attachment Uploads

By default, attachment embeds are converted to placeholder callout blocks in Notion. To enable real image uploads:

1. Set up an external file hosting endpoint (e.g., Cloudflare R2, S3, or your own server)
2. Enter the endpoint URL in **Settings → Attachment Upload URL**

The plugin will `POST` the file binary to this URL and use the returned `url` field as the Notion image source.

---

## Privacy & Security

Your Notion API token and page IDs are stored locally in `data.json` inside your vault and are **never sent anywhere** except directly to the official Notion API (`api.notion.com`). This file is excluded from version control by the plugin's `.gitignore`.

---

## Installation

### From Obsidian Community Plugins *(pending review)*

1. Open **Settings → Community Plugins → Browse**
2. Search for **Notion Sync**
3. Click **Install**, then **Enable**

### Manual Installation

1. Download the latest release from the [Releases](../../releases) page
2. Copy `main.js` and `manifest.json` into your vault's plugin folder:  
   `.obsidian/plugins/obsidian-notion-sync/`
3. Reload Obsidian and enable the plugin under **Settings → Community Plugins**

---

## Contributing

Pull requests and issues are welcome. Please open an issue before starting any large change so we can discuss the approach.

---

## License

[MIT](LICENSE)
