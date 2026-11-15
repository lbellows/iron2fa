import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

/** Let the user pick a file and return its text, or null if they cancelled. */
export async function pickTextFile(): Promise<string | null> {
  // No type filter: Proton names its exports "….json_1794680074", which has no
  // usable extension, and Android pickers hide files that fail the filter.
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('The browser did not hand over the file');
    return asset.file.text();
  }
  const { File } = await import('expo-file-system');
  const file = new File(asset.uri);
  try {
    return await file.text();
  } finally {
    // The picker's cache copy holds every secret in the export.
    try {
      file.delete();
    } catch {}
  }
}

/** Hand a text file to the user: a download on the desktop, the share sheet on Android. */
export async function saveTextFile(name: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const [{ Directory, File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (!dir.exists) dir.create();
  const file = new File(dir, name);
  file.create({ overwrite: true });
  file.write(text);
  // Not deleted here: shareAsync returns when the share sheet closes, which is
  // before the chosen app has read the file. removeOldExports() cleans up.
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
}

const EXPORT_DIR = 'export';
const EXPORT_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Delete exported files the receiving app has had time to read. Call at startup
 * and whenever the app returns to the foreground.
 */
export async function removeOldExports(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.cache, EXPORT_DIR);
    if (!dir.exists) return;
    const cutoff = Date.now() - EXPORT_LIFETIME_MS;
    for (const entry of dir.list()) {
      if (entry instanceof File && (entry.modificationTime ?? 0) <= cutoff) entry.delete();
    }
  } catch {}
}
