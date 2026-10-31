import React, { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Banknote, X } from 'lucide-react-native';
import { placeDropshipOrder, type DropshipPurchaseInfoMobile } from '../firebase';
import { GHANA_REGIONS } from '../regions';
import { deliveryDetailsProblem, formatPesewas, makeRequestId } from '../utils/dropship';

export const COD_MESSAGE = 'Pay only when you receive your order.';

interface Props {
  visible: boolean;
  productId: string;
  info: DropshipPurchaseInfoMobile;
  defaultName?: string;
  defaultPhone?: string;
  onClose: () => void;
  /** Called after the order is placed; the caller opens My orders. */
  onPlaced: (orderNumber: string) => void;
}

/** Pay-on-delivery checkout (same rules as the website): nothing is paid now; the buyer
 * pays the seller the total shown when the item arrives. The server sets every price. */
export function DropshipCheckout({ visible, productId, info, defaultName, defaultPhone, onClose, onPlaced }: Props) {
  const [qty, setQty] = useState(1);
  const [name, setName] = useState(defaultName ?? '');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [region, setRegion] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One id per checkout, so a retried tap can't create a second order.
  const requestId = useMemo(() => makeRequestId(), [visible]);
  const fee = info.deliveryFeePesewas ?? 0;
  const maxQty = Math.max(1, info.maxQuantity);
  const total = info.unitPricePesewas * qty + fee;

  const submit = async () => {
    const problem = deliveryDetailsProblem({ name, phone, region, area, address });
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      const o = await placeDropshipOrder({
        productId, quantity: qty, clientRequestId: requestId,
        delivery: { name: name.trim(), phone: phone.trim(), region, area: area.trim(), address: address.trim(),
                    ...(instructions.trim() ? { instructions: instructions.trim() } : {}) },
      });
      onPlaced(o.orderNumber);
    } catch (err: any) {
      setError(err?.message || "Couldn't place the order. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Order with pay on delivery</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10}><X size={20} color="#0f172a" /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.codBox}>
              <Text style={styles.codTitle}>{COD_MESSAGE}</Text>
              <Text style={styles.codText}>Nothing is paid now. Pay the seller {formatPesewas(total)} when the item reaches you. Never send money before delivery.</Text>
            </View>

            <Text style={styles.label}>Quantity</Text>
            <View style={styles.qtyRow}>
              <Pressable style={styles.qtyBtn} onPress={() => setQty(q => Math.max(1, q - 1))} accessibilityLabel="Fewer"><Text style={styles.qtyBtnText}>−</Text></Pressable>
              <Text style={styles.qtyValue}>{qty}</Text>
              <Pressable style={styles.qtyBtn} onPress={() => setQty(q => Math.min(maxQty, q + 1))} accessibilityLabel="More"><Text style={styles.qtyBtnText}>+</Text></Pressable>
            </View>

            <View style={styles.totals}>
              <Row label={`Item${qty > 1 ? `s (${qty})` : ''}`} value={formatPesewas(info.unitPricePesewas * qty)} />
              <Row label="Delivery" value={fee > 0 ? formatPesewas(fee) : 'Free'} />
              <Row label="Total to pay on delivery" value={formatPesewas(total)} strong />
            </View>

            <Text style={styles.label}>Full name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={80} autoComplete="name" textContentType="name" importantForAutofill="yes" />
            <Text style={styles.label}>Phone number</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} autoComplete="tel" textContentType="telephoneNumber" importantForAutofill="yes" />
            <Text style={styles.label}>Region</Text>
            <View style={styles.chips}>
              {GHANA_REGIONS.map(r => (
                <Pressable key={r.name} onPress={() => setRegion(r.name)} style={[styles.chip, region === r.name && styles.chipOn]}>
                  <Text style={[styles.chipText, region === r.name && styles.chipTextOn]}>{r.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Town or area</Text>
            <TextInput style={styles.input} value={area} onChangeText={setArea} maxLength={80} autoComplete="postal-address-locality" textContentType="addressCity" importantForAutofill="yes" />
            <Text style={styles.label}>Full address (house, street, landmark)</Text>
            <TextInput style={[styles.input, { minHeight: 60 }]} value={address} onChangeText={setAddress} maxLength={300} multiline autoComplete="street-address" textContentType="fullStreetAddress" importantForAutofill="yes" />
            <Text style={styles.label}>Delivery instructions (optional)</Text>
            <TextInput style={styles.input} value={instructions} onChangeText={setInstructions} maxLength={500} autoComplete="off" importantForAutofill="no" />
            <Text style={styles.note}>The seller will call you to confirm. Your details go only to the seller who delivers your order.</Text>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable disabled={busy} onPress={submit} style={[styles.cta, busy && { opacity: 0.6 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <><Banknote size={16} color="#fff" /><Text style={styles.ctaText}>Place order</Text></>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: '92%' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  codBox: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 12 },
  codTitle: { fontSize: 13, fontWeight: '900', color: '#064e3b' },
  codText: { fontSize: 12, color: '#065f46', marginTop: 2 },
  label: { fontSize: 11, color: '#64748b', marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  qtyValue: { fontSize: 16, fontWeight: '800', color: '#0f172a', minWidth: 24, textAlign: 'center' },
  totals: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#f1f5f9', paddingVertical: 8, marginTop: 12, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 13, color: '#64748b' },
  rowValue: { fontSize: 13, color: '#0f172a' },
  strong: { fontWeight: '900', color: '#0f172a' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  chipText: { fontSize: 12, color: '#334155' },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  note: { fontSize: 11, color: '#64748b', marginTop: 12 },
  error: { fontSize: 12, color: '#e11d48', fontWeight: '700', marginTop: 8 },
  cta: { marginTop: 14, backgroundColor: '#059669', borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
