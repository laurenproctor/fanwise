import { isJunkPath } from "./junk"

/**
 * What a drop or a folder picker actually handed over, with folders walked.
 *
 * A folder dragged from the desktop arrives as a `DataTransferItem` whose
 * entry is a directory; `dataTransfer.files` shows it as one nameless File and
 * says nothing about what is inside. Walking the entry gives every file in
 * every subfolder, which for a font family is the OTF, TTF and web folders a
 * foundry ships. Operating-system leftovers are dropped on the way.
 *
 * The entries must be taken from the transfer synchronously, inside the drop
 * handler: a `DataTransfer` is emptied once the event returns. The walk
 * itself is asynchronous and happens after.
 */

export interface DroppedFiles {
  /** Files dropped on their own. */
  loose: File[]
  /** Files found inside dropped folders, in walk order. */
  fromFolders: File[]
  /** The names of the folders that were dropped. */
  folders: string[]
}

export function collectDroppedFiles(transfer: DataTransfer): Promise<DroppedFiles> {
  const loose: File[] = []
  const directories: FileSystemDirectoryEntry[] = []

  const items = transfer.items ? Array.from(transfer.items) : []
  if (items.length === 0) {
    return Promise.resolve({ loose: Array.from(transfer.files), fromFolders: [], folders: [] })
  }

  for (const item of items) {
    if (item.kind !== "file") continue
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null
    if (entry && entry.isDirectory) {
      directories.push(entry as FileSystemDirectoryEntry)
      continue
    }
    const file = item.getAsFile()
    if (file) loose.push(file)
  }

  return (async () => {
    const fromFolders: File[] = []
    for (const directory of directories) {
      fromFolders.push(...(await walk(directory, directory.name)))
    }
    return { loose, fromFolders, folders: directories.map((directory) => directory.name) }
  })()
}

async function walk(directory: FileSystemDirectoryEntry, path: string): Promise<File[]> {
  const files: File[] = []
  for (const entry of await readAll(directory)) {
    const entryPath = `${path}/${entry.name}`
    if (isJunkPath(entryPath)) continue
    if (entry.isDirectory) {
      files.push(...(await walk(entry as FileSystemDirectoryEntry, entryPath)))
    } else if (entry.isFile) {
      files.push(await fileOf(entry as FileSystemFileEntry))
    }
  }
  return files
}

/** `readEntries` returns in batches and an empty batch means done. */
async function readAll(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) return all
    all.push(...batch)
  }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

/**
 * The files a folder picker chose, minus the leftovers, and the folder's name.
 * `webkitRelativePath` starts with the chosen folder on every file.
 */
export function pickedFolder(files: readonly File[]): { files: File[]; folder: string | null } {
  const kept = files.filter((file) => !isJunkPath(file.webkitRelativePath || file.name))
  const first = files[0]?.webkitRelativePath ?? ""
  const folder = first.includes("/") ? (first.split("/")[0] ?? null) : null
  return { files: kept, folder }
}
