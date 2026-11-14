import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { sanitizeSecret } from '../core/bytes';
import { Account, Algorithm, generateCode, newId, parseUri } from '../core/otp';
import { Button, Choice, Confirm, Field, Header, s } from './widgets';

/** Add a new account (no `account` prop) or rename/annotate/delete an existing one. */
export function Edit(props: {
  account?: Account;
  onSave: (account: Account) => void;
  onDelete?: () => void;
  onBack: () => void;
}) {
  const existing = props.account;
  const [issuer, setIssuer] = useState(existing?.issuer ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [secret, setSecret] = useState('');
  const [kind, setKind] = useState<'TOTP' | 'Steam'>('TOTP');
  const [algorithm, setAlgorithm] = useState<Algorithm>('SHA1');
  const [digits, setDigits] = useState('6');
  const [period, setPeriod] = useState('30');
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    try {
      if (existing) {
        props.onSave({ ...existing, issuer: issuer.trim(), label: label.trim(), note: note.trim() });
        return;
      }
      const input = secret.trim();
      let account: Account;
      if (/^(otpauth|steam):\/\//i.test(input)) {
        // A pasted link carries its own names and parameters; typed names win.
        account = parseUri(input);
        if (issuer.trim()) account.issuer = issuer.trim();
        if (label.trim()) account.label = label.trim();
      } else if (kind === 'Steam') {
        account = { id: newId(), kind: 'steam', issuer: issuer.trim() || 'Steam', label: label.trim(), secret: input, algorithm: 'SHA1', digits: 5, period: 30, note: '' };
      } else {
        const d = Number(digits);
        const p = Number(period);
        if (!Number.isInteger(d) || d < 4 || d > 10) throw new Error('Digits must be between 4 and 10.');
        if (!Number.isInteger(p) || p < 1 || p > 86400) throw new Error('Period must be a whole number of seconds.');
        account = { id: newId(), kind: 'totp', issuer: issuer.trim(), label: label.trim(), secret: sanitizeSecret(input), algorithm, digits: d, period: p, note: '' };
      }
      account.note = note.trim();
      generateCode(account, 0); // proves the secret decodes before anything is saved
      if (!account.issuer && !account.label) throw new Error('Give the account a name.');
      props.onSave(account);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={existing ? 'Edit account' : 'Add account'} onBack={props.onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        {existing ? null : (
          <>
            <Field
              label="Setup key or otpauth:// link"
              value={secret}
              onChangeText={setSecret}
              autoFocus
              secureTextEntry={false}
              hint="The key a site shows under “can't scan the QR code?”, or the full link."
            />
            <Choice label="Type" options={['TOTP', 'Steam'] as const} value={kind} onChange={setKind} />
          </>
        )}
        <Field label="Service" value={issuer} onChangeText={setIssuer} placeholder="GitHub" autoCapitalize="words" />
        <Field label="Account" value={label} onChangeText={setLabel} placeholder="me@example.com" />
        <Field label="Note" value={note} onChangeText={setNote} autoCapitalize="sentences" />
        {!existing && kind === 'TOTP' ? (
          advanced ? (
            <>
              <Choice label="Algorithm" options={['SHA1', 'SHA256', 'SHA512'] as const} value={algorithm} onChange={setAlgorithm} />
              <Field label="Digits" value={digits} onChangeText={setDigits} keyboardType="number-pad" />
              <Field label="Period (seconds)" value={period} onChangeText={setPeriod} keyboardType="number-pad" />
            </>
          ) : (
            <View style={{ marginBottom: 16, alignItems: 'flex-start' }}>
              <Button title="Advanced options" kind="plain" small onPress={() => setAdvanced(true)} />
            </View>
          )
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Button title="Save" onPress={save} />
        {props.onDelete ? (
          <View style={{ marginTop: 12 }}>
            <Button title="Delete account" kind="danger" onPress={() => setConfirming(true)} />
          </View>
        ) : null}
      </ScrollView>
      <Confirm
        visible={confirming}
        title="Delete this account?"
        message="Its codes stop being generated here. If the service still has two-factor turned on and you have no other copy of this key, you can be locked out."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          props.onDelete?.();
        }}
      />
    </View>
  );
}
