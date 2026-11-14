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
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
  } finally {
    try {
      file.delete();
    } catch {}
  }
}
