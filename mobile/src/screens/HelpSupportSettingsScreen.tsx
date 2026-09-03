import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { ChevronLeft, ShieldCheck, HelpCircle, FileText, Info } from 'lucide-react-native';
import { colors, radius, spacing, fonts } from '../theme';

interface Props {
  onBack: () => void;
}

// Matches web's ProfileSettings.tsx FAQ list exactly (src/components/ProfileSettings.tsx).
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'How do I buy on TedBuy Ghana?',
    a: "Browse listings on our official tedbuy.store domain in your preferred categories and regions. When you find an item of interest, tap the listing card to view detailed specifications. You can message the seller directly using our secure in-app peer chat, or click the WhatsApp button to initiate a direct chat to negotiate, arrange trade, or meet.",
  },
  {
    q: 'How do I post a classified ad?',
    a: "Tapping the 'Sell' button at the center of the mobile bottom nav bar opens the listing form. Fill in details, upload clear pictures or a 9:16 interactive video ad, choose your region and price, then publish. Note: verified active accounts receive higher query priority! All inputs are sanitized using industry-standard practices to eliminate security vulnerabilities.",
  },
  {
    q: 'How do the dynamic search specs and brand filters work?',
    a: 'When you select a primary category (such as Phones, Vehicles, Laptops, or Property), our dynamic hierarchical filter panel automatically reveals matching spec options (like Brand, Model, Condition, Bedroom counts, or Fuel Type). Choosing a brand dynamically refines the model list instantly, allowing progressive and powerful filtering just like Jiji or eBay!',
  },
  {
    q: 'What are Featured Listings and how does social media advertising boost my sales?',
    a: 'Featured Listings are top-tier promotional placements designed to give your products maximum market visibility. In addition to premium homepage banner placement and top search indexing on TedBuy, we actively launch targeted social media ad campaigns across Facebook, Instagram, and TikTok for Featured Listings. By bringing external buyer traffic directly to your item, Featured Listings significantly increase impressions, buyer inquiries, and your overall speed of sale!',
  },
  {
    q: 'What is Ad Boosting and how does it upgrade my listing?',
    a: 'Ad Boosting is our automated seller promotion system that instantly converts your product into a Featured Listing. Choosing a boost plan elevates your item to the top of search feeds with priority ranking and enrolls it into our external social media advertising pipeline across Facebook, Instagram, and TikTok. Sellers can choose from five flexible plan tiers (3 Days Fast Boost, 7 Days Hot Deal Boost, 14 Days Premium Boost, 21 Days Elite Merchant Boost, or 1 Month Mega Store Boost) with secure payments via Mobile Money (MoMo) or Card.',
  },
  {
    q: 'What are interactive 9:16 Video Ads?',
    a: 'They are immersive, vertical product video walkthroughs displayed directly in the feed for high buyer conversion. It is the best way to showcase real performance, physical condition, and build immediate buyer trust.',
  },
  {
    q: 'What is Account Verification?',
    a: 'To ensure a clean marketplace, buyers and sellers can undergo system verification. This validates active email accounts using a secure verification link and increases community safety. Complete your verification securely inside Settings → Account & Security.',
  },
  {
    q: 'Can I delete my listings?',
    a: 'Yes! You can easily delete any of your active listings from the product details page or your profile page. To protect seller ownership, listings can only be deleted by the original listing owner or verified system administrators.',
  },
  {
    q: 'How does the secure peer trade delivery tracking work?',
    a: "Inside your secure chat, the seller can mark an item as 'Delivered' once dispatched. The buyer is then prompted to confirm 'Picked Up'. Once both actions are complete, the trade advances to a 'Completed' state. For security, once a trade reaches this completed terminal state, it is locked against further modification by any standard user to protect the integrity of the transaction.",
  },
  {
    q: 'Are there listing fees?',
    a: 'Posting classified ads on Tedbuy Ghana is completely free. We do not charge listing fees or commissions. Trades and payments are completed directly between peers.',
  },
];

/** Dedicated Help & Support screen. Everything here previously lived under
 * the misleadingly-named "Merchant Settings" heading in ProfileScreen.tsx —
 * none of it was ever merchant-specific (just safety/help/legal content), so
 * it relocates here verbatim rather than into Selling & Buying. Terms of
 * Service and Privacy Policy text is preserved exactly as written; they
 * share one existing modal (with its own internal Help/Terms toggle) rather
 * than being split into two rewritten screens, since the Privacy Policy
 * content was already authored as a section within the Terms tab. App
 * Version is the one new addition — read live from Expo config, not hardcoded. */
export function HelpSupportSettingsScreen({ onBack }: Props) {
  const [isSafetyModalVisible, setIsSafetyModalVisible] = useState(false);
  const [isHelpModalVisible, setIsHelpModalVisible] = useState(false);
  const [helpActiveSection, setHelpActiveSection] = useState<'help' | 'terms'>('help');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const openHelp = () => { setHelpActiveSection('help'); setIsHelpModalVisible(true); };
  const openTerms = () => { setHelpActiveSection('terms'); setIsHelpModalVisible(true); };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={10}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Help &amp; Support</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group}>
          <Pressable onPress={() => setIsSafetyModalVisible(true)} style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}><ShieldCheck size={16} color={colors.text} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Classified Safety Guidelines</Text>
                <Text style={styles.rowSubtitle}>Important safety protocols for meeting buyers.</Text>
              </View>
            </View>
            <Text style={styles.chevron}>→</Text>
          </Pressable>

          <Pressable onPress={openHelp} style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}><HelpCircle size={16} color={colors.text} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Help &amp; FAQ</Text>
                <Text style={styles.rowSubtitle}>Guides and common questions.</Text>
              </View>
            </View>
            <Text style={styles.chevron}>→</Text>
          </Pressable>

          <Pressable onPress={openTerms} style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}><FileText size={16} color={colors.text} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Terms of Service &amp; Privacy Policy</Text>
                <Text style={styles.rowSubtitle}>Our platform agreements and data practices.</Text>
              </View>
            </View>
            <Text style={styles.chevron}>→</Text>
          </Pressable>
        </View>

        <View style={[styles.group, { marginTop: spacing.lg }]}>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={styles.rowLeft}>
              <View style={styles.iconBadge}><Info size={16} color={colors.text} /></View>
              <Text style={styles.rowTitle}>App Version</Text>
            </View>
            <Text style={styles.rowSubtitle}>{appVersion}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Safety Tips Overlay Modal */}
      <Modal animationType="slide" transparent visible={isSafetyModalVisible} onRequestClose={() => setIsSafetyModalVisible(false)}>
        <View style={styles.modalOverlayContainer}>
          <View style={styles.modalOverlayContent}>
            <View style={styles.modalOverlayHeader}>
              <Text style={styles.modalOverlayTitle}>Safety Protocol</Text>
              <Pressable onPress={() => setIsSafetyModalVisible(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalScrollBody}>
              <Text style={styles.safetyIntro}>
                TedBuy prioritizes the safety of both our buyers and merchants. Please review these classified trade tips:
              </Text>
              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>📍</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Meet in Public Spaces</Text>
                  <Text style={styles.safetyCardText}>
                    Always coordinate item inspection and exchanges in well-lit public zones like malls, banks, or transport hubs.
                  </Text>
                </View>
              </View>
              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>🔎</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Thoroughly Inspect the Item</Text>
                  <Text style={styles.safetyCardText}>
                    Carefully test mechanical objects, screens, chargers, clothing stitching, and serial numbers before providing funds.
                  </Text>
                </View>
              </View>
              <View style={styles.safetyCardItem}>
                <Text style={styles.safetyCardIcon}>💵</Text>
                <View style={styles.safetyCardTextContent}>
                  <Text style={styles.safetyCardTitle}>Secure Payments Only</Text>
                  <Text style={styles.safetyCardText}>
                    Use immediate digital transfers (Mobile Money) or cash. Never send advance deposits before viewing the classified item.
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setIsSafetyModalVisible(false)} style={styles.safetyAcknowledgeCta}>
                <Text style={styles.safetyAcknowledgeText}>I Understand</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Help & FAQ / Terms of Service Modal */}
      <Modal animationType="slide" transparent visible={isHelpModalVisible} onRequestClose={() => setIsHelpModalVisible(false)}>
        <View style={styles.modalOverlayContainer}>
          <View style={styles.modalOverlayContent}>
            <View style={styles.modalOverlayHeader}>
              <Text style={styles.modalOverlayTitle}>Support, Help &amp; Agreements</Text>
              <Pressable onPress={() => setIsHelpModalVisible(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.helpSegmentRow}>
              <Pressable
                onPress={() => setHelpActiveSection('help')}
                style={[styles.helpSegmentBtn, helpActiveSection === 'help' && styles.helpSegmentBtnActive]}
              >
                <Text style={[styles.helpSegmentBtnText, helpActiveSection === 'help' && styles.helpSegmentBtnTextActive]}>Help &amp; FAQ</Text>
              </Pressable>
              <Pressable
                onPress={() => setHelpActiveSection('terms')}
                style={[styles.helpSegmentBtn, helpActiveSection === 'terms' && styles.helpSegmentBtnActive]}
              >
                <Text style={[styles.helpSegmentBtnText, helpActiveSection === 'terms' && styles.helpSegmentBtnTextActive]}>Terms of Service</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollBody}>
              {helpActiveSection === 'help' ? (
                <>
                  <Text style={styles.faqSectionLabel}>Frequently Asked Questions</Text>
                  {FAQ_ITEMS.map((faq, idx) => {
                    const isOpen = openFaqIndex === idx;
                    return (
                      <View key={idx} style={styles.faqItem}>
                        <Pressable onPress={() => setOpenFaqIndex(isOpen ? null : idx)} style={styles.faqQuestionRow}>
                          <Text style={styles.faqQuestionText}>{faq.q}</Text>
                          <Text style={styles.faqToggleIcon}>{isOpen ? '−' : '+'}</Text>
                        </Pressable>
                        {isOpen && <Text style={styles.faqAnswerText}>{faq.a}</Text>}
                      </View>
                    );
                  })}
                </>
              ) : (
                <>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionTitle}>1. Agreement to Terms</Text>
                    <Text style={styles.termsSectionText}>
                      Welcome to Tedbuy Ghana Classifieds (tedbuy.store). By creating an account or browsing listings, you agree to comply with our commercial marketplace policies. Services are provided of mutual peer communication.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionTitle}>2. Use &amp; Listing Guidelines</Text>
                    <Text style={styles.termsSectionText}>
                      Users must provide accurate, non-misleading information for listings. Prohibited post items include illegal goods, counter-brand replicas, or unregistered financial services. We reserve prompt moderation rights over all publications.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionTitle}>3. Safety &amp; Payments Warning</Text>
                    <Text style={styles.termsSectionText}>
                      TedBuy Classifieds is a peer-to-peer advertising provider. All product delivery, physical inspect evaluation, and financial settlement is coordinated solely between buyer and seller.
                    </Text>
                    <View style={styles.termsWarningBox}>
                      <Text style={styles.termsWarningText}>⚠️ Never send advance deposits before verifying physical product ownership.</Text>
                    </View>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionTitle}>4. Privacy Policy &amp; Data Disclosure</Text>
                    <Text style={styles.termsSectionText}>
                      Tedbuy is fully committed to user privacy. We comply with general data protection rules, empowering you with the tools to manage, export, and erase your data at any time.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionSubTitle}>Information We Collect</Text>
                    <Text style={styles.termsSectionText}>
                      • Profile Metadata: Username, email address, phone number, WhatsApp number, and optional profile picture.{'\n'}
                      • User Content: Products/listings posted, reviews written, seller ratings, and connection network (followers/following).{'\n'}
                      • Messages &amp; Chats: Private peer-to-peer conversations to organize purchase, physical inspections, and payment terms.{'\n'}
                      • System Cookies &amp; Local Storage: Strictly necessary identifiers used to keep you securely signed in and save persistent layout states.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionSubTitle}>Lawful Basis for Processing</Text>
                    <Text style={styles.termsSectionText}>
                      • Consent: When you register or agree to our Cookie settings.{'\n'}
                      • Contract Fulfillment: Enabling direct buyer-to-seller classified marketplace communication.{'\n'}
                      • Legitimate Interests: Keeping the platform secure from spam, bots, fraudulent activity, or listing abuse.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionSubTitle}>Data Visibility &amp; Safety</Text>
                    <Text style={styles.termsSectionText}>
                      By default, Tedbuy is a classified matching marketplace. Therefore, to allow buyers to contact you, your WhatsApp number and Username are displayed publicly on listings you post. Private password credentials are stored as heavy one-way cryptographic hashes via Firebase Authentication and are never visible.
                    </Text>
                  </View>
                  <View style={styles.termsSection}>
                    <Text style={styles.termsSectionSubTitle}>Your Personal Data Rights</Text>
                    <Text style={styles.termsSectionText}>
                      Right to Access — View and update all your settings, profiles, and listing details transparently via Settings.{'\n\n'}
                      Right to Erasure — Permanently delete your profile and all your listings from our systems instantaneously in Settings → Account &amp; Security → Delete Account.
                    </Text>
                  </View>
                  <Text style={styles.termsFooterText}>Last edited: June 2026. Accra, Ghana.</Text>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 34, height: 34, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1, paddingRight: spacing.md },
  iconBadge: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.text },
  rowSubtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 16, color: colors.textFaint },
  modalOverlayContainer: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modalOverlayContent: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '88%' },
  modalOverlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOverlayTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.text },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  modalCloseBtnText: { fontSize: 14, color: colors.textMuted },
  modalScrollBody: { padding: spacing.lg, paddingBottom: spacing.xxl },
  safetyIntro: { fontSize: 13.5, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  safetyCardItem: { flexDirection: 'row', gap: 12, marginBottom: spacing.lg },
  safetyCardIcon: { fontSize: 22 },
  safetyCardTextContent: { flex: 1 },
  safetyCardTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.text, marginBottom: 3 },
  safetyCardText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  safetyAcknowledgeCta: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  safetyAcknowledgeText: { color: '#ffffff', fontSize: 14, fontFamily: fonts.bold },
  helpSegmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  helpSegmentBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  helpSegmentBtnActive: { backgroundColor: colors.primary },
  helpSegmentBtnText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textMuted },
  helpSegmentBtnTextActive: { color: '#ffffff' },
  faqSectionLabel: { fontSize: 13, fontFamily: fonts.extrabold, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.md },
  faqItem: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.md },
  faqQuestionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  faqQuestionText: { flex: 1, fontSize: 13.5, fontFamily: fonts.bold, color: colors.text },
  faqToggleIcon: { fontSize: 18, color: colors.textMuted },
  faqAnswerText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 19, marginTop: 8 },
  termsSection: { marginBottom: spacing.lg },
  termsSectionTitle: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.text, marginBottom: 6 },
  termsSectionSubTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text, marginBottom: 6 },
  termsSectionText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 19 },
  termsWarningBox: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: radius.sm, padding: 10, marginTop: 8 },
  termsWarningText: { fontSize: 12, color: '#92400e', fontFamily: fonts.semibold },
  termsFooterText: { fontSize: 11, color: colors.textFaint, textAlign: 'center', marginTop: spacing.md },
});
