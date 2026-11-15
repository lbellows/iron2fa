import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Account } from './src/core/otp';
import { Edit } from './src/ui/Edit';
import { List } from './src/ui/List';
import { Transfer } from './src/ui/Transfer';
import { Unlock } from './src/ui/Unlock';
import { Button, C, Confirm, Header, s } from './src/ui/widgets';
import * as vault from './src/vault';

type Phase = 'loading' | 'create' | 'locked' | 'unreadable' | 'ready';
type Screen = { name: 'list' } | { name: 'add' } | { name: 'edit'; id: string } | { name: 'transfer' };

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<vault.Session | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [saveError, setSaveError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  /** Why the vault did not open, when the reason is something other than a missing or wrong key. */
  const [openError, setOpenError] = useState('');

  const opened = (result: { session: vault.Session; accounts: Account[] }) => {
    setSession(result.session);
    setAccounts(result.accounts);
    setScreen({ name: 'list' });
    setPhase('ready');
  };

  const failed = (e: unknown) => {
    setOpenError(e instanceof vault.VaultUnreadable ? '' : e instanceof Error ? e.message : String(e));
    setPhase('unreadable');
  };

  const start = useCallback(async () => {
    setPhase('loading');
    try {
      if (vault.usesPassphrase) setPhase((await vault.vaultExists()) ? 'locked' : 'create');
      else opened(await vault.openWithDeviceKey());
    } catch (e) {
      failed(e);
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase !== 'ready' || screen.name === 'list') return false;
      setScreen({ name: 'list' });
      return true;
    });
    return () => sub.remove();
  }, [phase, screen]);

  /** Encrypt and store first; the UI only shows what is actually on disk. */
  const persist = async (next: Account[]) => {
    if (!session) return;
    try {
      await vault.save(session, next);
      setAccounts(next);
      setSaveError('');
    } catch (e) {
      setSaveError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };
  const persistAndReturn = (next: Account[]) => persist(next).then(() => setScreen({ name: 'list' }), () => {});

  const editing = screen.name === 'edit' ? accounts.find((a) => a.id === screen.id) : undefined;

  let content: React.ReactNode = null;
  if (phase === 'create') {
    content = <Unlock creating onSubmit={async (p) => opened(await vault.createWithPassphrase(p))} />;
  } else if (phase === 'locked') {
    content = (
      <Unlock
        creating={false}
        onSubmit={async (p) => {
          try {
            opened(await vault.unlockWithPassphrase(p));
          } catch (e) {
            // A wrong passphrase is retried on the unlock screen; anything else will not be cured by retyping.
            if (e instanceof vault.WrongPassphrase) throw e;
            failed(e);
          }
        }}
      />
    );
  } else if (phase === 'unreadable') {
    content = (
      <View>
        <Header title="Iron2FA" />
        {openError ? (
          <>
            <Text style={s.error}>The saved accounts could not be opened: {openError}</Text>
            <Text style={s.body}>
              This can be temporary, so try again first. Erasing deletes the saved accounts for good; only do it if
              you have a backup to import.
            </Text>
            <View style={{ marginBottom: 12 }}>
              <Button title="Try again" onPress={start} />
            </View>
          </>
        ) : (
          <>
            <Text style={s.error}>The saved accounts cannot be decrypted on this device.</Text>
            <Text style={s.body}>
              This happens when the saved data is damaged, or was restored without the key that encrypted it. The
              accounts cannot be recovered from here; start over and import a backup.
            </Text>
          </>
        )}
        <Button title="Erase and start over" kind="danger" onPress={() => setConfirmReset(true)} />
        <Confirm
          visible={confirmReset}
          title="Erase the saved accounts?"
          message="The saved data is deleted for good."
          confirmLabel="Erase"
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            setConfirmReset(false);
            await vault.destroy();
            start();
          }}
        />
      </View>
    );
  } else if (phase === 'ready') {
    if (screen.name === 'add') {
      content = <Edit onBack={() => setScreen({ name: 'list' })} onSave={(a) => persistAndReturn([...accounts, a])} />;
    } else if (screen.name === 'edit' && editing) {
      content = (
        <Edit
          account={editing}
          onBack={() => setScreen({ name: 'list' })}
          onSave={(a) => persistAndReturn(accounts.map((x) => (x.id === a.id ? a : x)))}
          onDelete={() => persistAndReturn(accounts.filter((x) => x.id !== editing.id))}
        />
      );
    } else if (screen.name === 'transfer') {
      content = <Transfer accounts={accounts} onImported={persist} onBack={() => setScreen({ name: 'list' })} />;
    } else {
      content = (
        <List
          accounts={accounts}
          onAdd={() => setScreen({ name: 'add' })}
          onEdit={(id) => setScreen({ name: 'edit', id })}
          onTransfer={() => setScreen({ name: 'transfer' })}
          onLock={
            vault.usesPassphrase
              ? () => {
                  setSession(null);
                  setAccounts([]);
                  setPhase('locked');
                }
              : undefined
          }
        />
      );
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={st.root}>
        <View style={st.column}>
          {saveError ? <Text style={s.error}>{saveError}</Text> : null}
          {content}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: 560, paddingHorizontal: 16 },
});
