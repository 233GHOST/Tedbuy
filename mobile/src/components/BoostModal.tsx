import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, StyleSheet, ScrollView, Image } from 'react-native';
import { Check, Phone, CreditCard, ShieldCheck, AlertCircle, Clock, X } from 'lucide-react-native';
import { Product } from '../types';
import { BOOST_PLANS, getBoostEndDate, isBoostActive } from '../utils/boost';
import { activateBoost } from '../firebase';
import { colors, fonts, radius, spacing } from '../theme';

interface BoostModalProps {
  visible: boolean;
  onClose: () => void;
  product: Product | null;
  onSuccess?: (updatedProduct: any) => void;
  isAdmin?: boolean;
}

type CheckoutStep = 'plan-select' | 'verifying' | 'success' | 'error';

/** Matches web's BoostModal (src/components/BoostModal.tsx). Web currently
 * runs boost checkout in demo mode (no live Paystack keys configured in this
 * environment), so this mirrors that same simulated momo/card confirmation
 * flow against the real /api/verify-payment endpoint, rather than inventing
 * a native payment-gateway integration the web app itself doesn't have yet.
 * Web also gives admins a third "Free Admin Boost" payment method that skips
 * straight to verification (same real /api/verify-payment call, just with a
 * distinct reference prefix and amountGHS:0) — was missing on mobile. */
export const BoostModal: React.FC<BoostModalProps> = ({ visible, onClose, product, onSuccess, isAdmin }) => {
  const [selectedPlanId, setSelectedPlanId] = useState('7days');
  const [paymentMethod, setPaymentMethod] = useState<'momo' | 'card' | 'admin'>('momo');
  const [step, setStep] = useState<CheckoutStep>('plan-select');
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  // Synchronous guard — the Pay buttons below have no `disabled` prop, and
  // `step` only unmounts them after the next render, leaving a brief window
  // where a fast double-tap could fire two payment/boost verifications.
  const isPayingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setStep('plan-select');
      setSelectedPlanId('7days');
      setError('');
      setReference('');
    }
  }, [visible]);

  if (!product) return null;

  const activePlan = BOOST_PLANS.find((p) => p.id === selectedPlanId) || BOOST_PLANS[1];
  const currentlyBoosted = isBoostActive(product);
  const boostEnd = getBoostEndDate(product);

  const handlePay = async () => {
    if (isPayingRef.current) return;
    isPayingRef.current = true;
    const isFreeAdminBoost = paymentMethod === 'admin';
    const ref = isFreeAdminBoost
      ? `ADMIN_FREE_BOOST_${Date.now()}`
      : `TEDBUY_MOBILE_${paymentMethod.toUpperCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    setReference(ref);
    setStep('verifying');
    try {
      const updated = await activateBoost(product.id, selectedPlanId, paymentMethod, isFreeAdminBoost ? 0 : activePlan.priceGHS, ref);
      setStep('success');
      if (onSuccess) onSuccess(updated);
    } catch (err: any) {
      setStep('error');
      setError(err.message || 'The payment gateway could not verify your transaction.');
    } finally {
      isPayingRef.current = false;
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>{currentlyBoosted ? 'Extend / Renew Boost' : 'Boost Your Listing'}</Text>
              <Text style={styles.headerSubtitle}>Place your ad at the absolute top of the feed</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            <View style={styles.productRow}>
              {product.images && product.images.length > 0 && (
                <Image source={{ uri: product.images[0] }} style={styles.productImg} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.productCategoryPill}>
                  <Text style={styles.productCategory}>{product.category || 'Listing'}</Text>
                </View>
                <Text style={styles.productTitle} numberOfLines={1}>{product.title}</Text>
                <Text style={styles.productPrice}>GHS {Number(product.price).toLocaleString()}</Text>
              </View>
            </View>

            {currentlyBoosted && boostEnd && (
              <View style={styles.activeBoostBanner}>
                <ShieldCheck size={18} color={colors.success} />
                <Text style={styles.activeBoostText}>
                  This listing is currently boosted until {boostEnd.toLocaleDateString()}. Purchasing a new package extends it.
                </Text>
              </View>
            )}

            {step === 'plan-select' && (
              <>
                <Text style={styles.sectionLabel}>1. Select Boost Duration</Text>
                {BOOST_PLANS.map((plan) => {
                  const selected = selectedPlanId === plan.id;
                  return (
                    <Pressable
                      key={plan.id}
                      onPress={() => setSelectedPlanId(plan.id)}
                      style={[styles.planCard, selected && styles.planCardSelected]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
                        <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                          {selected && <Check size={13} color="#fff" strokeWidth={3} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.planName}>{plan.name}</Text>
                            {plan.badge && (
                              <View style={styles.planBadge}>
                                <Text style={styles.planBadgeText}>{plan.badge}</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <Clock size={11} color={colors.textFaint} />
                            <Text style={styles.planDuration}>Promoted for {plan.durationDays} Full Days</Text>
                          </View>
                        </View>
                      </View>
                      <Text style={styles.planPrice}>GH₵ {plan.priceGHS}</Text>
                    </Pressable>
                  );
                })}

                <Text style={styles.sectionLabel}>2. Select Payment Method</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Pressable
                    onPress={() => setPaymentMethod('momo')}
                    style={[styles.methodBtn, paymentMethod === 'momo' && styles.methodBtnActive]}
                  >
                    <Phone size={16} color={paymentMethod === 'momo' ? '#fff' : colors.textMuted} />
                    <Text style={[styles.methodBtnText, paymentMethod === 'momo' && styles.methodBtnTextActive]}>Mobile Money</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPaymentMethod('card')}
                    style={[styles.methodBtn, paymentMethod === 'card' && styles.methodBtnActive]}
                  >
                    <CreditCard size={16} color={paymentMethod === 'card' ? '#fff' : colors.textMuted} />
                    <Text style={[styles.methodBtnText, paymentMethod === 'card' && styles.methodBtnTextActive]}>Visa / Mastercard</Text>
                  </Pressable>
                  {isAdmin && (
                    <Pressable
                      onPress={() => setPaymentMethod('admin')}
                      style={[styles.methodBtn, styles.methodBtnAdmin, paymentMethod === 'admin' && styles.methodBtnAdminActive]}
                    >
                      <Text style={[styles.methodBtnText, { color: colors.danger }, paymentMethod === 'admin' && styles.methodBtnTextActive]}>Free Admin Boost</Text>
                    </Pressable>
                  )}
                </View>

                {paymentMethod === 'admin' ? (
                  <View style={styles.adminBoostBox}>
                    <Text style={styles.adminBoostText}>
                      As an Administrator, you can activate this premium boost instantly for FREE. No transaction will be initiated.
                    </Text>
                    <Pressable onPress={handlePay} style={[styles.payBtn, styles.payBtnAdmin]}>
                      <Text style={styles.payBtnText}>Activate Free {activePlan.durationDays} Days Boost</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={handlePay} style={styles.payBtn}>
                    <Text style={styles.payBtnText}>Pay GH₵ {activePlan.priceGHS} via {paymentMethod === 'momo' ? 'Mobile Money' : 'Card'}</Text>
                  </Pressable>
                )}
              </>
            )}

            {step === 'verifying' && (
              <View style={styles.stepCenter}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.stepTitle}>Verifying Transaction Securely</Text>
                <Text style={styles.stepText}>Connecting to the payment gateway and verifying on the TedBuy backend...</Text>
                <View style={styles.refBox}>
                  <Text style={styles.refBoxText}>REF: {reference}</Text>
                </View>
              </View>
            )}

            {step === 'success' && (
              <View style={styles.stepCenter}>
                <View style={styles.successIcon}>
                  <ShieldCheck size={32} color={colors.success} />
                </View>
                <Text style={styles.stepTitle}>Premium Boost Activated!</Text>
                <Text style={styles.stepText}>
                  Your listing has been upgraded with a {activePlan.name} package and will appear at the top of the feed.
                </Text>
                <Pressable onPress={onClose} style={styles.payBtn}>
                  <Text style={styles.payBtnText}>Return to Dashboard</Text>
                </Pressable>
              </View>
            )}

            {step === 'error' && (
              <View style={styles.stepCenter}>
                <View style={styles.errorIcon}>
                  <AlertCircle size={32} color={colors.danger} />
                </View>
                <Text style={styles.stepTitle}>Verification Failed</Text>
                <Text style={[styles.stepText, { color: colors.danger }]}>{error}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Pressable onPress={() => setStep('plan-select')} style={styles.retryBtn}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </Pressable>
                  <Pressable onPress={onClose} style={styles.payBtn}>
                    <Text style={styles.payBtnText}>Dismiss</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.75)', justifyContent: 'flex-end' },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.textStrong },
  headerSubtitle: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  productRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  productImg: { width: 52, height: 52, borderRadius: radius.md },
  productCategoryPill: { alignSelf: 'flex-start', backgroundColor: '#e2e8f0', borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 },
  productCategory: { fontFamily: fonts.extrabold, fontSize: 9.5, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.4 },
  productTitle: { fontFamily: fonts.extrabold, fontSize: 15.5, color: colors.textStrong },
  productPrice: { fontFamily: fonts.extrabold, fontSize: 14, color: colors.primary, marginTop: 3 },
  activeBoostBanner: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  activeBoostText: { flex: 1, fontFamily: fonts.medium, fontSize: 11, color: colors.successDark, lineHeight: 16 },
  sectionLabel: { fontFamily: fonts.extrabold, fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm },
  planCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface },
  planCardSelected: { borderColor: colors.warning, backgroundColor: '#fffbeb' },
  radioOuter: { width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOuterSelected: { borderColor: colors.warning, backgroundColor: colors.warning },
  planName: { fontFamily: fonts.extrabold, fontSize: 13, color: colors.textStrong },
  planBadge: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  planBadgeText: { fontFamily: fonts.extrabold, fontSize: 8, color: '#92400e', textTransform: 'uppercase' },
  planDuration: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  planPrice: { fontFamily: fonts.extrabold, fontSize: 14, color: colors.textStrong },
  methodBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, backgroundColor: colors.surface },
  methodBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  methodBtnAdmin: { borderColor: '#fecdd3', backgroundColor: '#fff1f2' },
  methodBtnAdminActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  methodBtnText: { fontFamily: fonts.bold, fontSize: 11, color: colors.textMuted },
  methodBtnTextActive: { color: '#fff' },
  adminBoostBox: { marginTop: spacing.md, backgroundColor: '#fff1f2', borderWidth: 1, borderColor: '#fecdd3', borderRadius: radius.lg, padding: spacing.md },
  adminBoostText: { fontFamily: fonts.medium, fontSize: 11, color: '#9f1239', lineHeight: 16, textAlign: 'center' },
  payBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  payBtnAdmin: { backgroundColor: colors.danger, marginTop: spacing.md },
  payBtnText: { fontFamily: fonts.extrabold, fontSize: 12, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },
  retryBtn: { flex: 1, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  retryBtnText: { fontFamily: fonts.bold, fontSize: 12, color: colors.text },
  stepCenter: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  stepTitle: { fontFamily: fonts.extrabold, fontSize: 15, color: colors.textStrong, textAlign: 'center' },
  stepText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  refBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm },
  refBoxText: { fontFamily: fonts.bold, fontSize: 10, color: colors.textMuted },
  successIcon: { width: 56, height: 56, borderRadius: 999, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' },
  errorIcon: { width: 56, height: 56, borderRadius: 999, backgroundColor: '#ffe4e6', alignItems: 'center', justifyContent: 'center' },
});
