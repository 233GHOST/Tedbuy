import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import * as WebBrowser from 'expo-web-browser';
import { X, WifiOff } from 'lucide-react-native';
import { auth, requestAppHandoffToken } from '../firebase';
import {
  DROPSHIP_EMBED_URL,
  HANDOFF_MESSAGE_TYPE,
  READY_MESSAGE_TYPE,
  SIGNED_IN_MESSAGE_TYPE,
  decideOnReady,
  isTedbuyOrigin,
  parseEmbedMessage,
  shouldFallbackToBrowser,
} from '../utils/webHandoff';
import { colors, fonts, radius, spacing } from '../theme';

/** The plain (non-embedded) site, used as the Chrome Custom Tab fallback. */
const DROPSHIP_BROWSER_URL = 'https://www.tedbuy.store/dropship';
/** How long to keep the loading overlay up after a page load while waiting
 * for the site's first ready message (older site builds never send one). */
const READY_GRACE_MS = 4000;
/** How long a posted handoff may take to produce a signed-in page. */
const HANDOFF_PENDING_MS = 20000;
/** Hard cap on handoff posts per screen visit, so a page that reloads after
 * a failed sign-in can't drive an endless post → reload loop. */
const MAX_HANDOFF_POSTS = 2;

type Overlay = null | 'loading' | 'signing-in';
type ErrorKind = null | 'load' | 'signin';

interface Props {
  onClose: () => void;
}

/** TedBuy Dropship inside the app: the website's /dropship hub in a WebView,
 * signed in as the app user via a one-time custom-token handoff
 * (POST /api/auth/app-handoff → postMessage to the page). Navigation to any
 * other site leaves the WebView, so the token is only ever posted into a
 * https://www.tedbuy.store page. */
export function DropshipWebScreen({ onClose }: Props) {
  const webviewRef = useRef<WebView>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>('loading');
  const [error, setError] = useState<ErrorKind>(null);

  const closedRef = useRef(false);
  const currentUrlRef = useRef(DROPSHIP_EMBED_URL);
  const canGoBackRef = useRef(false);
  const postedThisLoadRef = useRef(false);
  const totalPostsRef = useRef(0);
  const handoffPendingRef = useRef(false);
  const requestInFlightRef = useRef(false);
  /** Bumped on Retry so a token request started for the previous WebView
   * instance can never post into the new one. */
  const generationRef = useRef(0);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    readyTimerRef.current = null;
    pendingTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    clearTimers();
    onClose();
  }, [clearTimers, onClose]);

  useEffect(() => () => {
    closedRef.current = true;
    clearTimers();
  }, [clearTimers]);

  const openInBrowserAndClose = useCallback(() => {
    WebBrowser.openBrowserAsync(DROPSHIP_BROWSER_URL).catch(() => {
      Alert.alert('Could Not Open Dropship', 'Please try again in a moment.');
    });
    close();
  }, [close]);

  const showError = useCallback((kind: Exclude<ErrorKind, null>) => {
    if (closedRef.current) return;
    handoffPendingRef.current = false;
    clearTimers();
    setOverlay(null);
    setError(kind);
  }, [clearTimers]);

  const markSignedIn = useCallback(() => {
    handoffPendingRef.current = false;
    clearTimers();
    setOverlay(null);
  }, [clearTimers]);

  // Android hardware Back: WebView history first, then close the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!error && canGoBackRef.current && webviewRef.current) {
        webviewRef.current.goBack();
      } else {
        close();
      }
      return true;
    });
    return () => sub.remove();
  }, [close, error]);

  const startHandoff = useCallback(async () => {
    if (requestInFlightRef.current) return;
    const generation = generationRef.current;
    requestInFlightRef.current = true;
    postedThisLoadRef.current = true;
    totalPostsRef.current += 1;
    handoffPendingRef.current = true;
    setOverlay('signing-in');

    const result = await requestAppHandoffToken();
    if (closedRef.current || generation !== generationRef.current) return;
    requestInFlightRef.current = false;

    if (!result.ok) {
      handoffPendingRef.current = false;
      if (shouldFallbackToBrowser(result.status)) {
        openInBrowserAndClose();
      } else {
        Alert.alert("Couldn't sign you in to Dropship", 'Please try again in a moment. If this keeps happening, sign out of the app and sign back in.');
        close();
      }
      return;
    }

    const uid = auth.currentUser?.uid;
    // Re-check where the WebView is right now: the fetch took time and the
    // page may have navigated. Never post the token anywhere but TedBuy.
    if (!uid || !isTedbuyOrigin(currentUrlRef.current) || !webviewRef.current) {
      showError('signin');
      return;
    }
    webviewRef.current.postMessage(JSON.stringify({ type: HANDOFF_MESSAGE_TYPE, token: result.token, uid }));
    pendingTimerRef.current = setTimeout(() => {
      if (handoffPendingRef.current) showError('signin');
    }, HANDOFF_PENDING_MS);
  }, [close, openInBrowserAndClose, showError]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    if (closedRef.current || error) return;
    // Only listen to TedBuy pages.
    if (!isTedbuyOrigin(event.nativeEvent.url)) return;
    const msg = parseEmbedMessage(event.nativeEvent.data);
    if (!msg) return;
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
    const appUid = auth.currentUser?.uid ?? null;

    if (msg.type === SIGNED_IN_MESSAGE_TYPE) {
      if (msg.uid === appUid) markSignedIn();
      else showError('signin');
      return;
    }

    if (msg.type === READY_MESSAGE_TYPE) {
      // Token still being fetched — nothing posted to the page yet, so an
      // auth-settling ready from the page is not a failed sign-in.
      if (requestInFlightRef.current && msg.uid !== appUid) return;
      const decision = decideOnReady({
        pageUid: msg.uid,
        appUid,
        currentUrl: currentUrlRef.current,
        alreadyPosted: postedThisLoadRef.current,
        handoffPending: handoffPendingRef.current,
      });
      if (decision === 'none') {
        if (msg.uid === appUid) markSignedIn();
        else setOverlay(null);
      } else if (decision === 'handoff') {
        if (totalPostsRef.current >= MAX_HANDOFF_POSTS) showError('signin');
        else startHandoff();
      } else if (decision === 'error') {
        showError('signin');
      }
      // 'wait': the site is signing the previous account out before signing
      // the app user in — keep the overlay up.
    }
  }, [error, markSignedIn, showError, startHandoff]);

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    // Sub-frames (iOS only reports them) may embed third-party widgets; only
    // top-level navigations decide where the page — and the token — goes.
    if (!req.isTopFrame) return true;
    if (isTedbuyOrigin(req.url) || req.url === 'about:blank') return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    if (nav.url) currentUrlRef.current = nav.url;
    canGoBackRef.current = nav.canGoBack;
  }, []);

  const onLoadStart = useCallback((e: { nativeEvent: WebViewNavigation }) => {
    if (e.nativeEvent.url) currentUrlRef.current = e.nativeEvent.url;
    // A new document: the "once per page load" handoff budget resets (the
    // screen-wide MAX_HANDOFF_POSTS still applies).
    if (!requestInFlightRef.current && !handoffPendingRef.current) postedThisLoadRef.current = false;
    if (!handoffPendingRef.current) setOverlay('loading');
  }, []);

  const onLoadEnd = useCallback(() => {
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    readyTimerRef.current = setTimeout(() => {
      readyTimerRef.current = null;
      setOverlay((o) => (o === 'loading' ? null : o));
    }, READY_GRACE_MS);
  }, []);

  const retry = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    postedThisLoadRef.current = false;
    totalPostsRef.current = 0;
    handoffPendingRef.current = false;
    requestInFlightRef.current = false;
    canGoBackRef.current = false;
    currentUrlRef.current = DROPSHIP_EMBED_URL;
    setError(null);
    setOverlay('loading');
    setLoadKey((k) => k + 1);
  }, [clearTimers]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <View style={{ width: 34 }} />
        <Text style={styles.headerTitle}>TedBuy Dropship</Text>
        <Pressable
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close Dropship"
          style={styles.closeButton}
        >
          <X size={24} color={colors.text} strokeWidth={2.5} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {!error && (
          <WebView
            key={loadKey}
            ref={webviewRef}
            source={{ uri: DROPSHIP_EMBED_URL }}
            style={styles.webview}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onNavigationStateChange={onNavigationStateChange}
            onLoadStart={onLoadStart}
            onLoadEnd={onLoadEnd}
            onError={(e) => { e.preventDefault(); showError('load'); }}
            onRenderProcessGone={() => showError('load')}
            onContentProcessDidTerminate={() => webviewRef.current?.reload()}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled={false}
          />
        )}

        {!error && overlay && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.overlayText}>
              {overlay === 'signing-in' ? 'Signing you in…' : 'Loading Dropship…'}
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <WifiOff size={36} color={colors.textMuted} />
            <Text style={styles.errorTitle}>
              {error === 'load' ? "Couldn't load Dropship" : "Couldn't sign you in to Dropship"}
            </Text>
            <Text style={styles.errorText}>
              {error === 'load'
                ? 'Check your internet connection and try again.'
                : 'Try again, or open Dropship in your browser instead.'}
            </Text>
            <Pressable onPress={retry} style={[styles.button, styles.buttonPrimary]} accessibilityRole="button">
              <Text style={styles.buttonPrimaryText}>Retry</Text>
            </Pressable>
            <Pressable onPress={openInBrowserAndClose} style={[styles.button, styles.buttonSecondary]} accessibilityRole="button">
              <Text style={styles.buttonSecondaryText}>Open in browser</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
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
  headerTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: colors.text },
  closeButton: { width: 34, height: 34, alignItems: 'flex-end', justifyContent: 'center' },
  body: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  overlayText: { marginTop: spacing.md, fontSize: 14, fontFamily: fonts.semibold, color: colors.textMuted },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorTitle: { marginTop: spacing.lg, fontSize: 17, fontFamily: fonts.extrabold, color: colors.text, textAlign: 'center' },
  errorText: { marginTop: spacing.sm, marginBottom: spacing.xl, fontSize: 14, fontFamily: fonts.medium, color: colors.textMuted, textAlign: 'center' },
  button: { alignSelf: 'stretch', paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonPrimaryText: { color: colors.textOnDark, fontSize: 15, fontFamily: fonts.bold },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonSecondaryText: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
});
