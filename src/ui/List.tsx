import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, generateCode, secondsRemaining } from '../core/otp';
import { Button, C, Header, s } from './widgets';

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

function grouped(code: string): string {
  if (code.length <= 5) return code;
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

function Row(props: { account: Account; now: number; copied: boolean; onCopy: (code: string) => void; onEdit: () => void }) {
  const { account, now } = props;
  const step = Math.floor(now / account.period);
  const code = useMemo(() => {
    try {
      return generateCode(account, step * account.period);
    } catch {
      return null;
    }
  }, [account, step]);
  const left = secondsRemaining(account, now);
  const title = account.issuer || account.label || 'Unnamed';
  const subtitle = account.issuer ? account.label : '';

  return (
    <View style={st.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy code for ${title}${subtitle ? `, ${subtitle}` : ''}`}
        disabled={!code}
        onPress={() => code && props.onCopy(code)}
        style={({ pressed }) => [st.rowMain, pressed && { opacity: 0.6 }]}>
        <Text style={st.issuer} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={st.label} numberOfLines={1}>{subtitle}</Text> : null}
        <Text style={[st.code, left <= 5 && { color: C.warn }]}>
          {props.copied ? 'Copied' : code ? grouped(code) : 'Invalid secret'}
        </Text>
        <View style={st.track}>
          <View style={[st.bar, { width: `${(left / account.period) * 100}%` }, left <= 5 && { backgroundColor: C.warn }]} />
        </View>
      </Pressable>
      <View style={st.rowSide}>
        <Text style={st.left}>{left}s</Text>
        <Button title="Edit" kind="plain" small onPress={props.onEdit} />
      </View>
    </View>
  );
}

export function List(props: {
  accounts: Account[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onTransfer: () => void;
  onLock?: () => void;
}) {
  const now = useNow();
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.accounts;
    return props.accounts.filter((a) => `${a.issuer} ${a.label} ${a.note}`.toLowerCase().includes(q));
  }, [props.accounts, query]);

  const copy = async (id: string, code: string) => {
    await Clipboard.setStringAsync(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1200);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="Tumbler"
        right={
          <>
            {props.onLock ? <Button title="Lock" kind="plain" small onPress={props.onLock} /> : null}
            <Button title="Import / Export" kind="plain" small onPress={props.onTransfer} />
            <Button title="+ Add" small onPress={props.onAdd} />
          </>
        }
      />
      {props.accounts.length === 0 ? (
        <View style={st.empty}>
          <Text style={st.emptyTitle}>No accounts yet</Text>
          <Text style={[s.body, { textAlign: 'center' }]}>
            Import your Proton Authenticator export, or add an account with its setup key.
          </Text>
          <Button title="Import from Proton Authenticator" onPress={props.onTransfer} />
        </View>
      ) : (
        <>
          {props.accounts.length >= 5 ? (
            <TextInput
              accessibilityLabel="Search accounts"
              placeholder="Search"
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              value={query}
              onChangeText={setQuery}
              style={[s.input, { marginBottom: 12 }]}
            />
          ) : null}
          <FlatList
            data={shown}
            keyExtractor={(a) => a.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={<Text style={s.body}>Nothing matches “{query}”.</Text>}
            renderItem={({ item }) => (
              <Row
                account={item}
                now={now}
                copied={copiedId === item.id}
                onCopy={(code) => copy(item.id, code)}
                onEdit={() => props.onEdit(item.id)}
              />
            )}
          />
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, marginBottom: 10, overflow: 'hidden' },
  rowMain: { flex: 1, padding: 14 },
  rowSide: { padding: 12, alignItems: 'flex-end', justifyContent: 'space-between' },
  issuer: { color: C.text, fontSize: 16, fontWeight: '700' },
  label: { color: C.dim, fontSize: 13, marginTop: 2 },
  code: { color: C.accent, fontSize: 30, fontWeight: '700', letterSpacing: 2, marginTop: 8, fontVariant: ['tabular-nums'] },
  track: { height: 3, backgroundColor: C.line, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  bar: { height: 3, backgroundColor: C.accent },
  left: { color: C.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { color: C.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
});
