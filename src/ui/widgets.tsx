import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

export const C = {
  bg: '#0f172a',
  card: '#1e293b',
  line: '#334155',
  text: '#f1f5f9',
  dim: '#94a3b8',
  accent: '#38bdf8',
  onAccent: '#082f49',
  danger: '#f87171',
  warn: '#fbbf24',
};

export function Button(props: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  small?: boolean;
}) {
  const kind = props.kind ?? 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.button,
        props.small && s.buttonSmall,
        kind === 'primary' && { backgroundColor: C.accent },
        kind === 'plain' && { borderColor: C.line, borderWidth: 1 },
        kind === 'danger' && { borderColor: C.danger, borderWidth: 1 },
        (pressed || props.disabled) && { opacity: 0.5 },
      ]}>
      <Text
        style={[
          s.buttonText,
          kind === 'primary' && { color: C.onAccent },
          kind === 'danger' && { color: C.danger },
        ]}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { label, hint, style, ...rest } = props;
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={C.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, style]}
        {...rest}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Choice<T extends string>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{props.label}</Text>
      <View style={s.choiceRow}>
        {props.options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: option === props.value }}
            onPress={() => props.onChange(option)}
            style={[s.choice, option === props.value && s.choiceOn]}>
            <Text style={[s.choiceText, option === props.value && { color: C.onAccent }]}>{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Alert.alert does nothing on react-native-web, so confirmations are a Modal on every platform. */
export function Confirm(props: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={s.backdrop}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{props.title}</Text>
          <Text style={s.dialogText}>{props.message}</Text>
          <View style={s.dialogButtons}>
            <Button title="Cancel" kind="plain" onPress={props.onCancel} />
            <Button title={props.confirmLabel} kind="danger" onPress={props.onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Header(props: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {props.onBack ? <Button title="‹ Back" kind="plain" small onPress={props.onBack} /> : null}
      <Text accessibilityRole="header" style={s.title}>
        {props.title}
      </Text>
      {props.right}
    </View>
  );
}

export const s = StyleSheet.create({
  button: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { color: C.text, fontSize: 15, fontWeight: '600' },
  field: { marginBottom: 16 },
  label: { color: C.dim, fontSize: 13, marginBottom: 6 },
  hint: { color: C.dim, fontSize: 12, marginTop: 6, lineHeight: 17 },
  input: {
    color: C.text, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  choiceOn: { backgroundColor: C.accent, borderColor: C.accent },
  choiceText: { color: C.text, fontSize: 14, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: C.card, borderRadius: 14, padding: 20, width: '100%', maxWidth: 420 },
  dialogTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  dialogText: { color: C.dim, fontSize: 15, lineHeight: 21, marginBottom: 20 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  title: { color: C.text, fontSize: 22, fontWeight: '700', flex: 1 },
  body: { color: C.dim, fontSize: 15, lineHeight: 21, marginBottom: 16 },
  error: { color: C.danger, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  ok: { color: C.accent, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  section: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 8 },
});
