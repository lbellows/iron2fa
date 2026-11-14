import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Account } from '../core/otp';
import {
  BadPassword, exportEncrypted, exportPlain, importExport, isEncryptedExport, mergeAccounts,
} from '../core/proton';
import { pickTextFile, saveTextFile } from '../files';
import { Button, Field, Header, s } from './widgets';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Transfer(props: {
  accounts: Account[];
  onImported: (accounts: Account[]) => Promise<void>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  /** Text of an encrypted export waiting for its password. */
  const [pending, setPending] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [exportPassword, setExportPassword] = useState('');

  const finishImport = async (text: string, password?: string) => {
    setError('');
    setBusy(password ? 'Decrypting… this can take a little while on a phone.' : 'Importing…');
    try {
      // Let the status line paint before the key derivation blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { accounts, errors } = await importExport(text, password);
      const { merged, added } = mergeAccounts(props.accounts, accounts);
      if (added > 0) await props.onImported(merged);
      const skipped = accounts.length - added;
      setResult(
        `Imported ${added} account${added === 1 ? '' : 's'}` +
          (skipped ? `, skipped ${skipped} already here` : '') +
          (errors.length ? `, ${errors.length} could not be read:\n${errors.join('\n')}` : '.')
      );
      setPending(null);
      setImportPassword('');
    } catch (e) {
      setError(e instanceof BadPassword ? 'Wrong password — try again.' : message(e));
    } finally {
      setBusy('');
    }
  };

  const pick = async () => {
    setError('');
    setResult('');
    try {
      const text = await pickTextFile();
      if (text === null) return;
      if (isEncryptedExport(text)) setPending(text);
      else await finishImport(text);
    } catch (e) {
      setError(message(e));
    }
  };

  const doExport = async () => {
    setError('');
    setResult('');
    setBusy(exportPassword ? 'Encrypting…' : 'Exporting…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const text = exportPassword ? await exportEncrypted(props.accounts, exportPassword) : exportPlain(props.accounts);
      await saveTextFile(`Iron2FA_export_${new Date().toISOString().slice(0, 10)}.json`, text);
      setExportPassword('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Import / Export" onBack={props.onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        {busy ? <Text style={s.ok}>{busy}</Text> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {result ? <Text style={s.ok}>{result}</Text> : null}

        <Text style={s.section}>Import</Text>
        <Text style={s.body}>
          In Proton Authenticator choose Settings → Export, then pick that file here. Exports with and without a
          password both work, and so do exports made by Iron2FA. Accounts you already have are skipped.
        </Text>
        {pending === null ? (
          <Button title="Choose export file" disabled={!!busy} onPress={pick} />
        ) : (
          <>
            <Field label="Export password" value={importPassword} onChangeText={setImportPassword} secureTextEntry autoFocus
              onSubmitEditing={() => importPassword && finishImport(pending, importPassword)} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Cancel" kind="plain" disabled={!!busy} onPress={() => { setPending(null); setImportPassword(''); setError(''); }} />
              <Button title="Decrypt and import" disabled={!!busy || !importPassword} onPress={() => finishImport(pending, importPassword)} />
            </View>
          </>
        )}

        <Text style={[s.section, { marginTop: 32 }]}>Export</Text>
        <Text style={s.body}>
          Writes every account to one file in Proton Authenticator's format — use it as a backup, or to copy your
          accounts to Iron2FA on another device.
        </Text>
        <Field label="Password (recommended)" value={exportPassword} onChangeText={setExportPassword} secureTextEntry
          hint="Without a password the file holds your secrets in plain text: anyone who reads it can generate your codes." />
        <Button
          title={exportPassword ? 'Export encrypted file' : 'Export unencrypted file'}
          kind={exportPassword ? 'primary' : 'plain'}
          disabled={!!busy || props.accounts.length === 0}
          onPress={doExport}
        />
      </ScrollView>
    </View>
  );
}
