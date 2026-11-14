import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, Header, s } from './widgets';

/** Desktop only: create the vault passphrase on first run, ask for it afterwards. */
export function Unlock(props: { creating: boolean; onSubmit: (passphrase: string) => Promise<void> }) {
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (props.creating && passphrase.length < 8) return setError('Use at least 8 characters.');
    if (props.creating && passphrase !== repeat) return setError('The two passphrases do not match.');
    setError('');
    setBusy(true);
    try {
      await props.onSubmit(passphrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View>
      <Header title="Iron2FA" />
      <Text style={s.body}>
        {props.creating
          ? 'Choose a passphrase. It encrypts your accounts on this computer and is asked for every time the app opens. It cannot be recovered, so keep an export somewhere safe.'
          : 'Enter your passphrase to unlock your accounts.'}
      </Text>
      <Field label="Passphrase" value={passphrase} onChangeText={setPassphrase} secureTextEntry autoFocus
        onSubmitEditing={props.creating ? undefined : submit} />
      {props.creating ? (
        <Field label="Repeat passphrase" value={repeat} onChangeText={setRepeat} secureTextEntry onSubmitEditing={submit} />
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button title={busy ? 'Working…' : props.creating ? 'Create vault' : 'Unlock'} disabled={busy || !passphrase} onPress={submit} />
    </View>
  );
}
