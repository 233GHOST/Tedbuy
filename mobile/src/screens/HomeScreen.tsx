import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTabBarVisibility, TAB_BAR_HEIGHT } from '../context/TabBarVisibility';
import { Bookmark, MessageSquare, Share2, Eye, VolumeX, Volume2, TrendingUp, Store, MapPin, Check, Flame, RefreshCw, ChevronDown, ChevronUp, X, History, LayoutDashboard, LayoutGrid, Video, Play } from 'lucide-react-native';
import { categories } from '../data';
import { GHANA_REGIONS, getRegionForLocation } from '../regions';
import { computeDiscoverSellers } from '../utils/discoverSellers';
import { computeTrendingProducts } from '../utils/trendingProducts';
import { sortProductsByRanking } from '../utils/productSelector';
import { isBoostActive } from '../utils/boost';
import { formatProductPrice } from '../utils/formatPrice';
import { resolveProductImageUri } from '../utils/productImage';
import { getOptimizedVideoUrlMobile } from '../utils/cloudinary';
import { CategoryImagePlaceholder } from '../components/CategoryImagePlaceholder';
import { useSavedProducts } from '../context/SavedProducts';
import { CATEGORY_FILTERS, getModelsForBrand } from '../utils/filterConfig';
import { Product, isUserVerified, isUserAdmin } from '../types';
import { auth, fetchProducts, fetchProductsWithStatus, fetchVideoAds, watchProducts, watchUsers, startChatApi, toggleFollowSeller } from '../firebase';
import { EmailVerificationModal } from '../components/EmailVerificationModal';
import { fonts } from '../theme';

/** Real video playback for the "Watch Video Ads" feed.
 *
 * Every video plays back the seller's raw as-uploaded file. A playback-time
 * Cloudinary transform (q_auto,f_auto,w_720,c_limit, via
 * getOptimizedVideoUrlMobile) was tried here to cut file size, but that
 * transform is computed lazily — the first time ANYONE requests a given
 * video at that exact transformation, Cloudinary fully re-encodes it
 * server-side before sending back a single byte, which presented as a video
 * that just never loads for whoever hit it first. Reverted (that function is
 * now a pass-through) — see its comment in utils/cloudinary.ts for the
 * right way to actually get this benefit (an eager transform at upload
 * time, not a playback-time URL rewrite).
 *
 * What's still fixed here:
 * 1. expo-video starts buffering a source the moment a VideoPlayer is given
 *    one, even before play() is called (this is by design — it's how you
 *    preload). Left unmanaged, every mounted item downloads its full video
 *    regardless of whether it's actually about to be watched. `shouldLoad`
 *    (passed to VideoFeedRow below) is the fix: only items inside the load
 *    window ever have a real source and thus ever download anything.
 *
 *    That window has gone through two measured iterations. Active-only
 *    (briefly): live-instrumented timing (mount → statusChange →
 *    readyToPlay) showed the active video's own readyToPlay drop from
 *    5.48s to 2.75s once it stopped sharing bandwidth with a concurrent
 *    next-item preload, with zero mid-playback rebuffering. But that traded
 *    away two real product requirements — swipe-forward not always
 *    cold-starting, and scrolling back not re-fetching a video just
 *    watched. Current: preload the next 2 items ahead (accepting that same
 *    bandwidth-sharing cost deliberately, since "swipe never waits" won out
 *    against "the very first video is maximally fast"), and never tear
 *    down a player for an index once it's been visited — see
 *    `visitedVideoIndicesRef` and the `shouldLoadVideo` comment at the
 *    renderItem call site.
 *
 *    shouldLoad gates whether VideoFeedPlayer — and with it useVideoPlayer,
 *    which creates a real native player object the instant it's called,
 *    even with a null source — is mounted AT ALL (see VideoFeedRow), not
 *    just whether it has a source once mounted. A native video view/player
 *    is a genuinely expensive thing to have alive (its own decoder/
 *    compositor layer) regardless of whether anything is loaded into it,
 *    and an earlier version of this gate only hid the <VideoView> while
 *    still creating a player object for every cell the FlatList kept
 *    mounted for smooth paging (windowSize), not just the ones actually in
 *    the load window. Two even earlier attempts at fixing the resulting
 *    scroll jank missed this entirely: pairing a tight FlatList windowSize
 *    with removeClippedSubviews caused outright freezes (that combination
 *    fights native video decoders on iOS during view recycling), and
 *    removing all windowing let RN's default ~10-screens-each-way
 *    virtualization mount a heavy VideoView per cell regardless. The actual
 *    fix is here: cap how many cells ever get a real player+VideoView
 *    (shouldLoad) independently of how many cells FlatList keeps mounted
 *    for smooth paging (windowSize) — everything outside the load window is
 *    just the poster Image, which virtualizes fine on its own.
 */
const VideoFeedPlayer = React.memo(function VideoFeedPlayer({ uri, productId, posterUri, isActive, isMuted }: { uri: string; productId: string; posterUri?: string | null; isActive: boolean; isMuted: boolean }) {
  const optimizedUri = useMemo(() => getOptimizedVideoUrlMobile(uri), [uri]);
  useEffect(() => {
    console.log('VIDEO_TIMING player_created', productId, Date.now());
  }, []);
  // This component is now only ever mounted (by VideoFeedRow, below) once
  // shouldLoad is already true for this item — never earlier. Each row is
  // permanently keyed to one product id (keyExtractor) and videoFeedItems
  // is append-only (never updates an existing entry in place), so `uri`
  // can never change during this component's lifetime: it mounts fresh,
  // for this exact item, with its real source already known. That removes
  // the need for the create-with-null-then-replaceAsync-later dance this
  // used to do (and with it, the unmount-race that produced "NotFoundException:
  // Unable to find the native shared object" under fast swiping) — the
  // source is simply correct from the moment the native player exists.
  const player = useVideoPlayer(optimizedUri, (p) => {
    p.loop = true;
    p.muted = isMuted;
    // Android's default BufferOptions (preferredForwardBufferDuration: 20s,
    // minBufferForPlayback: 2s) is tuned for long-form content, not ~14s
    // vertical clips. Measured directly against this feed's actual
    // Cloudinary delivery: the CDN edge itself responds in ~7ms (cache hit,
    // confirmed via the `server-timing` response header), and this
    // environment sustains ~514-630KB/s to it — against a video whose own
    // real playback bitrate (computed from Cloudinary's own content-info:
    // bytes/duration) is only ~256KB/s, i.e. the network delivers content
    // ~2-2.5x faster than the video consumes it. minBufferForPlayback's 2s
    // default was the single largest lever actually inside this app's
    // control: at that ~2x margin it's paying for a safety cushion the
    // network doesn't need. 0.75s keeps a real cushion (still ~2x over what
    // a bare minimum would be) while cutting a meaningful chunk off
    // mount-to-playing. preferredForwardBufferDuration's 20s default is
    // longer than most of these clips ARE — for a ~14s video that's "keep
    // trying to buffer the whole thing, indefinitely," which is what
    // produced the repeated loading↔readyToPlay cycles observed during
    // live testing whenever bandwidth was shared with preloading videos.
    // 8s is comfortably more than minBufferForPlayback while no longer
    // fighting every other in-flight request for the rest of the clip.
    p.bufferOptions = { minBufferForPlayback: 0.75, preferredForwardBufferDuration: 8 };
  });

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  // A tap on the video toggles this; it's intentionally separate from
  // `isActive` (which is scroll-driven) so a manual pause survives things
  // like a mute toggle, and resets for free on the next video because this
  // component only ever mounts fresh for whichever item is currently
  // active (see the mount comment above) — there's no stale paused flag to
  // carry across items.
  const [isPaused, setIsPaused] = useState(false);
  useEffect(() => {
    if (isActive && !isPaused) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, isPaused, player]);

  const [isBuffering, setIsBuffering] = useState(true);
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      console.log('VIDEO_TIMING status_' + status, productId, Date.now());
      setIsBuffering(status === 'loading');
    });
    const sub2 = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      if (isPlaying) console.log('VIDEO_TIMING playing', productId, Date.now());
    });
    return () => { sub.remove(); sub2.remove(); };
  }, [player, productId]);

  return (
    <Pressable
      style={styles.videoPlaceholderImage}
      onPress={() => setIsPaused((prev) => !prev)}
    >
      {/* Instant first paint (already a lightweight q_auto poster frame, see
          resolveProductImageUri) so this shows a real frame from frame one
          instead of a blank black rectangle while the video buffers — the
          VideoView covers it completely once playback actually starts. */}
      {!!posterUri && (
        <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {/* A native VideoView is a genuinely heavy view to have mounted — its
          own decoder/compositor layer. VideoFeedPlayer (this whole
          component, including its player) now only mounts at all for items
          inside VideoFeedRow's load window, so unlike before there's no
          "shouldLoad=false but still mounted" state left to gate here. */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="cover"
        pointerEvents="none"
      />
      {isActive && isBuffering && !isPaused && (
        <View style={styles.videoBufferingOverlay} pointerEvents="none">
          <ActivityIndicator color="#ffffff" size="small" />
        </View>
      )}
      {isPaused && (
        <View style={styles.videoPauseOverlay} pointerEvents="none">
          <Play size={30} color="#ffffff" fill="#ffffff" strokeWidth={0} />
        </View>
      )}
    </Pressable>
  );
});

const HomePreloadVideo = React.memo(function HomePreloadVideo({ uri }: { uri: string }) {
  const optimizedUri = useMemo(() => getOptimizedVideoUrlMobile(uri), [uri]);
  // Same fact VideoFeedPlayer's own top comment relies on: a VideoPlayer
  // starts buffering the moment it's given a source, before play() and
  // with no VideoView at all. That's the entire mechanism here — no
  // rendering, nothing ever shown, just warming the OS-level HTTP cache
  // for this URL before the user has opened Watch Video Ads. Cloudinary
  // serves these with `Cache-Control: public, immutable, max-age=2592000`
  // (confirmed via a direct HEAD request against this feed's actual video
  // URLs), which is about as cache-friendly as an HTTP response gets — the
  // real VideoFeedPlayer's later fetch of the same URL should be served
  // from that warm cache rather than going back to origin.
  useVideoPlayer(optimizedUri, (p) => {
    p.muted = true;
  });
  return null;
});

/** Silently preloads the first 2 video ads as soon as product data has
 * loaded, regardless of whether the user has opened Watch Video Ads yet —
 * rendered from HomeScreen below, gated on viewMode === 'grid' AND on the
 * real feed not having been opened yet (see visitedVideoIndicesRef at the
 * call site): once the user has actually entered the feed, the real
 * VideoFeedPlayer instances take over via shouldLoad/visited persistence,
 * and re-mounting this every time the user flips back to Classifieds would
 * just be a redundant fetch for videos already cached. */
function HomePreloadVideos({ items }: { items: Product[] }) {
  const uris = useMemo(
    () => items.slice(0, 2)
      .map((p) => (Array.isArray((p as any).videos) ? (p as any).videos[0] : undefined))
      .filter((uri): uri is string => !!uri),
    [items]
  );
  return (
    <View style={{ width: 0, height: 0, overflow: 'hidden' }} pointerEvents="none">
      {uris.map((uri) => <HomePreloadVideo key={uri} uri={uri} />)}
    </View>
  );
}
import { ProductCard } from '../components/ProductCard';
import { SellerCard } from '../components/SellerCard';
import { TedBuyLogo } from '../components/TedBuyLogo';
import { getForYouProducts } from '../utils/recommendationScore';

// Animated.event with useNativeDriver requires the scrollable component to
// be wrapped via createAnimatedComponent — a plain FlatList throws
// "must be wrapped with Animated.createAnimatedComponent" at runtime.
// createAnimatedComponent's TS types drop the generic <ItemT> FlatList
// normally infers for data/renderItem — cast back to FlatList's own type so
// TS keeps inferring `item` correctly; the runtime wrapping is unaffected.
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;

/** One full-screen cell of the video feed — mute toggle, bottom details,
 * right-hand action column. Extracted out of HomeScreen's renderItem (where
 * it lived inline) and memoized for the same reason as VideoFeedPlayer
 * above: HomeScreen is a huge screen with live product/user listeners and
 * lots of state unrelated to this feed, so it re-renders often, and without
 * memoization every one of those re-renders was recreating every mounted
 * cell's entire element tree (several Pressables, badges, text) for no
 * visible reason — real, if smaller, work piling up during scroll.
 *
 * The comparator below deliberately ignores the callback props (onToggleSave
 * etc.) — they're plain closures redefined on every HomeScreen render, and
 * chasing that down across this whole file wasn't worth the risk right now.
 * It only compares what actually determines the rendered output; any real
 * data change that should affect behavior (e.g. the seller's WhatsApp
 * number) flows through `sellerProfile`, which IS compared, so that still
 * forces a fresh render (and with it, fresh callbacks) when it matters. */
const VideoFeedRow = React.memo(function VideoFeedRow({
  item,
  height,
  isActive,
  shouldLoad,
  isMuted,
  isSaved,
  sellerProfile,
  isOwnVideoItem,
  isFollowingSeller,
  isTogglingFollow,
  onToggleMute,
  onOpenSeller,
  onToggleFollow,
  onToggleSave,
  onStartChat,
  onShare,
  onOpenProductPress,
}: {
  item: Product;
  height: number;
  isActive: boolean;
  shouldLoad: boolean;
  isMuted: boolean;
  isSaved: boolean;
  sellerProfile: any;
  isOwnVideoItem: boolean;
  isFollowingSeller: boolean;
  isTogglingFollow: boolean;
  onToggleMute: () => void;
  onOpenSeller: (sellerId: string) => void;
  onToggleFollow: (sellerId: string) => void;
  onToggleSave: (item: Product) => void;
  onStartChat: (item: Product) => void;
  onShare: (item: Product) => void;
  onOpenProductPress: (item: Product) => void;
}) {
  const videoUri = Array.isArray((item as any).videos) ? (item as any).videos[0] : undefined;
  const videoFallbackImageUri = resolveProductImageUri(item);

  return (
    <View style={[styles.videoPlayerFrame, { height }]}>
      {videoUri && shouldLoad ? (
        // VideoFeedPlayer unconditionally calls useVideoPlayer(), which
        // creates a real native player object (decoder/audio-session shell)
        // the moment it mounts — even with a null source. shouldLoad was
        // only gating whether that player got a source/VideoView, not
        // whether it existed at all, so every row the FlatList kept mounted
        // for smooth virtualization (windowSize, wider than the 3-item load
        // window) was quietly holding its own native player instance.
        // Mounting VideoFeedPlayer itself only inside the load window means
        // exactly the items that should have a player are the only ones
        // that ever create one; everything else below just shows the same
        // poster image VideoFeedPlayer would have shown anyway, so there's
        // no visible change when a cell crosses into the load window.
        <VideoFeedPlayer uri={videoUri} productId={item.id} posterUri={videoFallbackImageUri} isActive={isActive} isMuted={isMuted} />
      ) : videoFallbackImageUri ? (
        <Image source={{ uri: videoFallbackImageUri }} style={styles.videoPlaceholderImage} />
      ) : (
        <CategoryImagePlaceholder category={item.category} style={styles.videoPlaceholderImage} iconSize={40} />
      )}
      <View style={styles.videoOverlay} pointerEvents="none" />

      {/* Mute toggle */}
      <Pressable style={styles.videoMuteBtn} onPress={onToggleMute} hitSlop={8}>
        {isMuted ? (
          <VolumeX size={16} color="#ffffff" strokeWidth={2.2} />
        ) : (
          <Volume2 size={16} color="#ffffff" strokeWidth={2.2} />
        )}
      </Pressable>

      {/* Immersive bottom details row */}
      <View style={styles.videoBottomDetails}>
        <View style={styles.featuredTag}>
          <Text style={styles.featuredTagText}>🔥 VIDEO SPOTLIGHT</Text>
        </View>
        <Text style={styles.videoProductTitle}>{item.title}</Text>
        <View style={styles.videoPriceLocationRow}>
          <Text style={styles.videoProductPrice}>{formatProductPrice(item.price)}</Text>
          <View style={styles.videoLocationBadge}>
            <MapPin size={10} color="#ffffff" strokeWidth={2.3} />
            <Text style={styles.videoLocationText}>{item.location || 'Ghana'}</Text>
          </View>
        </View>
        <Text style={styles.videoProductDesc} numberOfLines={2}>
          {item.description || 'Verified listing with live video inspection score.'}
        </Text>
      </View>

      {/* Snapchat-style Right hand column of action buttons */}
      <View style={styles.videoRightActionsColumn}>
        <Pressable
          style={styles.videoAvatarContainer}
          onPress={() => item.sellerId && onOpenSeller(item.sellerId)}
        >
          <View style={styles.videoAvatar}>
            <Text style={styles.videoAvatarText}>
              {String(item.sellerName || 'VS').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          {(isUserAdmin(sellerProfile) || isUserVerified(sellerProfile)) && (
            <View style={styles.videoVerifiedBadge}>
              <Check size={9} color="#ffffff" strokeWidth={3.5} />
            </View>
          )}
          {!isOwnVideoItem && !isFollowingSeller && (
            <Pressable
              style={styles.subscribeBadge}
              onPress={() => item.sellerId && onToggleFollow(item.sellerId)}
              hitSlop={8}
            >
              {isTogglingFollow ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.subscribeBadgeText}>+</Text>
              )}
            </Pressable>
          )}
        </Pressable>

        {/* Bookmark button */}
        <Pressable style={styles.actionBtn} onPress={() => onToggleSave(item)}>
          <View style={[styles.actionBtnCircle, isSaved && styles.actionBtnCircleActive]}>
            <Bookmark size={17} color="#ffffff" fill={isSaved ? '#ffffff' : 'none'} strokeWidth={2.2} />
          </View>
          <Text style={styles.actionBtnLabel}>{isSaved ? 'Saved' : 'Save'}</Text>
        </Pressable>

        {/* WhatsApp Chat */}
        <Pressable style={styles.actionBtn} onPress={() => onStartChat(item)}>
          <View style={[styles.actionBtnCircle, { backgroundColor: '#059669' }]}>
            <MessageSquare size={17} color="#ffffff" strokeWidth={2.2} />
          </View>
          <Text style={styles.actionBtnLabel}>Chat</Text>
        </Pressable>

        {/* Share */}
        <Pressable style={styles.actionBtn} onPress={() => onShare(item)}>
          <View style={styles.actionBtnCircle}>
            <Share2 size={17} color="#ffffff" strokeWidth={2.2} />
          </View>
          <Text style={styles.actionBtnLabel}>Share</Text>
        </Pressable>

        {/* Specs */}
        <Pressable style={styles.actionBtn} onPress={() => onOpenProductPress(item)}>
          <View style={[styles.actionBtnCircle, { backgroundColor: '#ffffff' }]}>
            <Eye size={17} color="#0f172a" strokeWidth={2.2} />
          </View>
          <Text style={styles.actionBtnLabel}>Specs</Text>
        </Pressable>
      </View>
    </View>
  );
}, (prev, next) => (
  prev.item.id === next.item.id &&
  prev.item.title === next.item.title &&
  prev.item.price === next.item.price &&
  prev.item.location === next.item.location &&
  prev.item.description === next.item.description &&
  prev.item.sellerName === next.item.sellerName &&
  prev.item.sellerId === next.item.sellerId &&
  prev.item.category === next.item.category &&
  prev.height === next.height &&
  prev.isActive === next.isActive &&
  prev.shouldLoad === next.shouldLoad &&
  prev.isMuted === next.isMuted &&
  prev.isSaved === next.isSaved &&
  prev.sellerProfile === next.sellerProfile &&
  prev.isOwnVideoItem === next.isOwnVideoItem &&
  prev.isFollowingSeller === next.isFollowingSeller &&
  prev.isTogglingFollow === next.isTogglingFollow
));

interface HomeScreenProps {
  onOpenProduct: (product: Product) => void;
  route?: any;
  navigation?: any;
}

const categoryIcons: Record<string, string> = {
  All: '🌐',
  Phones: '📱',
  'Laptops & Computers': '💻',
  Laptops: '💻',
  Fashion: '👟',
  'Home Appliances': '🔌',
  Vehicles: '🚗',
  Property: '🏠',
  'Furniture & Home': '🛋️',
  'Beauty and Care': '✨',
  Games: '🎮',
  Electronics: '⚡',
  Services: '🛠️',
  'Jobs & Employment': '💼',
  'Agriculture & Food': '🌾',
  'Pets & Animals': '🐾',
  'Sports & Fitness': '🏋️',
  'Kids & Baby': '👶',
  'Commercial & Tools': '🏗️',
  'Books & Hobbies': '📚',
  Other: '📦',
};

export function HomeScreen({ onOpenProduct, route, navigation }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { onScroll: onTabBarScroll, resetTabBar, setIsDarkTabBar } = useTabBarVisibility();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'video'>('grid');
  useEffect(() => {
    if (route?.params?.resetToGrid) {
      setViewMode('grid');
    }
  }, [route?.params?.resetToGrid]);
  // Bring the tab bar back whenever this screen loses focus (so it's not
  // left hidden on another tab) or the grid/video toggle changes (each
  // starts its own scroll position, so a leftover hidden state would be
  // stuck until the user scrolled up again for no reason).
  useEffect(() => {
    const unsubscribe = navigation?.addListener?.('blur', () => {
      resetTabBar();
      setIsDarkTabBar(false);
    });
    return unsubscribe;
  }, [navigation, resetTabBar, setIsDarkTabBar]);
  useEffect(() => {
    resetTabBar();
    setIsDarkTabBar(viewMode === 'video');
  }, [viewMode, resetTabBar, setIsDarkTabBar]);
  useEffect(() => {
    if (route?.params?.category) {
      setSelectedCategory(route.params.category);
      setViewMode('grid');
    }
  }, [route?.params?.category]);
  useEffect(() => {
    if (route?.params?.search) {
      setSearchText(route.params.search);
      setViewMode('grid');
    }
  }, [route?.params?.search]);
  // Matches web's SearchSuggestions "in Location: {city}" chip
  // (onSelectLocation) — previously mobile's search had no way to land on
  // Home pre-filtered by city; this wires the same location-quick-filter
  // chip through to the existing Ghana Location Filters state.
  useEffect(() => {
    if (route?.params?.location) {
      setSelectedRegion(getRegionForLocation(route.params.location));
      setSelectedCity(route.params.location);
      setViewMode('grid');
    }
  }, [route?.params?.location]);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  // Every index that has ever been active this session — once a video has
  // been watched, its player is never torn down again (see shouldLoadVideo
  // at the renderItem call site), so scrolling back to it resumes instantly
  // with no re-fetch, offline included, for as long as the app stays open.
  // A plain mutable ref, not state: it only needs to affect what the next
  // render's shouldLoadVideo computes, and that render is already happening
  // because activeVideoIndex (state) just changed — a second state update
  // here would just be a redundant extra render.
  const visitedVideoIndicesRef = useRef<Set<number>>(new Set([0]));
  useEffect(() => {
    visitedVideoIndicesRef.current.add(activeVideoIndex);
  }, [activeVideoIndex]);
  const [videoFeedHeight, setVideoFeedHeight] = useState(0);
  // The bottom tab navigator keeps Home mounted when you switch to another
  // tab (e.g. Profile) — activeVideoIndex doesn't change, so without this
  // the "active" video kept isActive=true and just went on playing (with
  // sound) in the background behind whatever screen you switched to. Ties
  // playback to actual screen focus, not just which item is scrolled to.
  const [isHomeScreenFocused, setIsHomeScreenFocused] = useState(true);
  useEffect(() => {
    const unsubFocus = navigation?.addListener?.('focus', () => setIsHomeScreenFocused(true));
    const unsubBlur = navigation?.addListener?.('blur', () => setIsHomeScreenFocused(false));
    return () => {
      unsubFocus?.();
      unsubBlur?.();
    };
  }, [navigation]);
  // Matches web's VideoAdsFeed default (isMuted starts false — autoplay
  // attempts with sound on, same as TikTok/Reels-style feeds).
  const [isVideoFeedMuted, setIsVideoFeedMuted] = useState(false);
  const videoViewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onVideoViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      console.log('VIDEO_TIMING item_selected', viewableItems[0].item?.id, viewableItems[0].index, Date.now());
      setActiveVideoIndex(viewableItems[0].index);
    }
  }).current;
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Distinguishes "the feed is genuinely empty" from "the request failed" —
  // both used to render as the same blank grid with zero explanation.
  const [feedLoadFailed, setFeedLoadFailed] = useState(false);
  // Real bookmark state (savedProductIds) — shared across every screen via
  // context, not a screen-local overlay. See context/SavedProducts.tsx and
  // firebase.ts's toggleSaveProductRemote.
  const { savedProductIds, isSaved: isSavedProduct, toggleSaved: toggleSavedProduct } = useSavedProducts();
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [minPriceFilter, setMinPriceFilter] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [selectedBrandFilter, setSelectedBrandFilter] = useState('');
  // Matches web's DynamicCategoryFilters.tsx — real, working category-
  // specific filtering (Vehicles: Fuel Type/Transmission/Year, Property:
  // Bedrooms/Bathrooms, Phones: Storage/RAM/Color, etc). Was entirely
  // absent on mobile: every category showed the same generic min/max price
  // filter only, so a buyer could never filter Vehicles by fuel type or
  // Property by bedroom count on mobile even though web supports it.
  const [extraFilters, setExtraFilters] = useState<Record<string, string>>({});

  // Matches web's DynamicCategoryFilters.tsx "Jiji-style promotional banner"
  // quick-shortcut chips — was never ported (deferred across two earlier
  // cycles). Two of the three chips per category are real, working filter
  // shortcuts (price cap, one-tap extraFilters set); the "Value/Rent
  // Estimator" chip is cosmetic on web too (just an informational toast,
  // no real valuation tool behind it) — kept for visual parity since it's
  // harmless marketing chrome, not a misleading broken feature.
  const promoBanners = useMemo(() => {
    const setExtra = (fieldId: string, value: string) => setExtraFilters((prev) => ({ ...prev, [fieldId]: value }));
    switch (selectedCategory) {
      case 'Phones':
        return [
          { title: 'Value my phone', icon: '📊', action: () => Alert.alert('Phone Valuation', 'Our algorithms estimate market value based on current live specs!') },
          { title: 'Budget-friendly', icon: '💰', action: () => { setMinPriceFilter(''); setMaxPriceFilter('2000'); } },
          { title: 'Big Battery phones', icon: '🔋', action: () => setExtra('network', '5G Network') },
        ];
      case 'Laptops':
        return [
          { title: 'Value my laptop', icon: '📊', action: () => Alert.alert('Laptop Valuation', 'Optimal trade pricing suggested!') },
          { title: 'Budget-friendly', icon: '💰', action: () => { setMinPriceFilter(''); setMaxPriceFilter('4500'); } },
          { title: 'Core i7 Power', icon: '⚡', action: () => setExtra('processor', 'Intel Core i7') },
        ];
      case 'Vehicles':
        return [
          { title: 'Car Value Guide', icon: '📊', action: () => Alert.alert('Car Value Guide', 'Assessing market resale value guides for vehicles in Ghana...') },
          { title: 'Smart Budgets', icon: '💰', action: () => { setMinPriceFilter(''); setMaxPriceFilter('80000'); } },
          { title: 'Automatic Drive', icon: '⚙️', action: () => setExtra('transmission', 'Automatic') },
        ];
      case 'Property':
        return [
          { title: 'Rent Estimator', icon: '📈', action: () => Alert.alert('Rent Estimator', 'Check average local rental indices!') },
          { title: 'Cozy Rooms', icon: '💰', action: () => { setMinPriceFilter(''); setMaxPriceFilter('3000'); } },
          { title: 'Fully Furnished', icon: '🛋️', action: () => setExtra('furnishedStatus', 'Fully Furnished') },
        ];
      default:
        return [
          { title: 'Value Estimator', icon: '🏷️', action: () => Alert.alert('Value Estimator', 'Estimating best market rates for listings!') },
          { title: 'Budget Options', icon: '💰', action: () => { setMinPriceFilter(''); setMaxPriceFilter('1500'); } },
          { title: 'Brand New Deals', icon: '✨', action: () => setExtra('condition', 'Brand New') },
        ];
    }
  }, [selectedCategory]);

  // Matches web's DynamicCategoryFilters.tsx priceRanges quick-chip buttons —
  // category-tuned min/max presets (Phones/Laptops/Vehicles/Property each
  // get realistic ranges for that category; other categories share a
  // smaller default set). Was entirely absent on mobile — only free-text
  // min/max TextInputs existed, no one-tap common ranges.
  const priceRangePresets = useMemo(() => {
    switch (selectedCategory) {
      case 'Phones':
        return [
          { label: '< GH₵ 1.2 K', min: '', max: '1200' },
          { label: 'GH₵ 1.2 - 2 K', min: '1200', max: '2000' },
          { label: 'GH₵ 2 - 3.3 K', min: '2000', max: '3300' },
          { label: '> GH₵ 3.3 K', min: '3300', max: '' },
        ];
      case 'Laptops':
        return [
          { label: '< GH₵ 2.5 K', min: '', max: '2500' },
          { label: 'GH₵ 2.5 - 4.5 K', min: '2500', max: '4500' },
          { label: 'GH₵ 4.5 - 8 K', min: '4500', max: '8000' },
          { label: '> GH₵ 8 K', min: '8000', max: '' },
        ];
      case 'Vehicles':
        return [
          { label: '< GH₵ 40 K', min: '', max: '40000' },
          { label: 'GH₵ 40 - 80 K', min: '40000', max: '80000' },
          { label: 'GH₵ 80 - 150 K', min: '80000', max: '150000' },
          { label: '> GH₵ 150 K', min: '150000', max: '' },
        ];
      case 'Property':
        return [
          { label: '< GH₵ 1.5 K', min: '', max: '1500' },
          { label: 'GH₵ 1.5 - 4 K', min: '1500', max: '4000' },
          { label: 'GH₵ 4 - 10 K', min: '4000', max: '10000' },
          { label: '> GH₵ 10 K', min: '10000', max: '' },
        ];
      default:
        return [
          { label: '< GH₵ 500', min: '', max: '500' },
          { label: 'GH₵ 500 - 1.5 K', min: '500', max: '1500' },
          { label: 'GH₵ 1.5 - 4 K', min: '1500', max: '4000' },
          { label: '> GH₵ 4 K', min: '4000', max: '' },
        ];
    }
  }, [selectedCategory]);

  // Matches web's Sort Ads / Sort Price dropdowns (App.tsx) — was previously
  // a hardcoded "Newest First" label with no actual sorting behind it.
  const [sortByAds, setSortByAds] = useState<'newest' | 'oldest'>('newest');
  const [sortByPrice, setSortByPrice] = useState<'default' | 'asc' | 'desc'>('default');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState<'ads' | 'price' | null>(null);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [selectedCity, setSelectedCity] = useState('All');
  // Matches web's AppContext.tsx recentlyViewedIds + App.tsx's "Recently
  // Viewed" panel — was entirely absent on mobile. Written by
  // ProductDetailScreen.tsx on view, re-read here on every focus since the
  // list is populated from a different screen while this one stays mounted.
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const RECENTLY_VIEWED_KEY = 'tedbuy_recently_viewed_ids';
  useEffect(() => {
    const loadRecentlyViewed = () => {
      AsyncStorage.getItem(RECENTLY_VIEWED_KEY).then((saved) => {
        if (!saved) { setRecentlyViewedIds([]); return; }
        try { setRecentlyViewedIds(JSON.parse(saved)); } catch { setRecentlyViewedIds([]); }
      });
    };
    loadRecentlyViewed();
    const unsub = navigation?.addListener?.('focus', loadRecentlyViewed);
    return unsub;
  }, [navigation]);
  const recentlyViewedProducts = useMemo(() => {
    if (recentlyViewedIds.length === 0) return [];
    return recentlyViewedIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is Product => !!p);
  }, [recentlyViewedIds, products]);
  const clearRecentlyViewed = () => {
    setRecentlyViewedIds([]);
    AsyncStorage.removeItem(RECENTLY_VIEWED_KEY).catch(() => {});
  };

  // Auto-swipe state for Featured Listings carousel (1.5s interval)
  const featuredScrollRef = useRef<ScrollView | null>(null);
  const mainGridRef = useRef<FlatList | null>(null);
  const featuredIndexRef = useRef<number>(0);
  const [featuredActiveIndex, setFeaturedActiveIndex] = useState<number>(0);
  const [isFeaturedPaused, setIsFeaturedPaused] = useState<boolean>(false);
  const featuredPauseTimeoutRef = useRef<any>(null);
  const FEATURED_CARD_STEP = 175 + 12;

  // Close filter dropdown on category change
  useEffect(() => {
    setIsFilterDropdownOpen(false);
    setMinPriceFilter('');
    setMaxPriceFilter('');
    setSelectedBrandFilter('');
    setExtraFilters({});
  }, [selectedCategory]);

  // Listen to parameters from Search or Sell navigation
  useEffect(() => {
    if (route?.params?.category) {
      setSelectedCategory(route.params.category);
    }
    if (route?.params?.search) {
      setSearchText(route.params.search);
    }
  }, [route?.params]);

  useEffect(() => {
    const unsubProducts = watchProducts((result, failed) => {
      setProducts(result as Product[]);
      setFeedLoadFailed(!!failed && result.length === 0);
      setLoading(false);
    });

    const unsubUsers = watchUsers((result) => {
      setUsers(result);
    });

    return () => {
      unsubProducts();
      unsubUsers();
    };
  }, []);

  // Fetch server search results when search query or category changes
  useEffect(() => {
    if (!searchText.trim() && selectedCategory === 'All') return;

    let active = true;

    fetchProducts(200, searchText, selectedCategory).then((items) => {
      if (!active) return;
      if (Array.isArray(items) && items.length > 0) {
        setProducts((prev) => {
          const map = new Map<string, Product>();
          prev.forEach((p) => { if (p && p.id) map.set(String(p.id), p as Product); });
          items.forEach((p) => { if (p && p.id) map.set(String(p.id), p as Product); });
          return Array.from(map.values());
        });
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [searchText, selectedCategory]);

  const filteredProducts = useMemo(() => {
    const list = products.filter((product) => {
      const title = String(product.title || '').toLowerCase();
      const description = String(product.description || '').toLowerCase();
      const category = String(product.category || 'Other');
      const brand = String((product as any).brand || '').toLowerCase();
      const location = String(product.location || '').toLowerCase();
      const query = searchText.toLowerCase().trim();

      const matchesCategory = selectedCategory === 'All' || 
        category === selectedCategory ||
        (category.toLowerCase().includes('laptop') && selectedCategory.toLowerCase().includes('laptop')) ||
        (category.toLowerCase().includes('computer') && selectedCategory.toLowerCase().includes('computer'));
      const matchesSearch = !query ||
        title.includes(query) ||
        description.includes(query) ||
        category.toLowerCase().includes(query) ||
        brand.includes(query) ||
        location.includes(query);

      const price = Number(product.price) || 0;
      const matchesMin = !minPriceFilter || price >= Number(minPriceFilter);
      const matchesMax = !maxPriceFilter || price <= Number(maxPriceFilter);
      const matchesBrand = !selectedBrandFilter || brand.includes(selectedBrandFilter.toLowerCase()) || title.includes(selectedBrandFilter.toLowerCase());
      const matchesRegion = selectedRegion === 'All' || getRegionForLocation(product.location) === selectedRegion;
      const matchesCity = selectedCity === 'All' || location.includes(selectedCity.toLowerCase());

      // Matches web's productSelector.ts matchesExtra logic exactly (same
      // category-specific field matching: check the product's own attribute
      // first, falling back to a title/description keyword match when the
      // product has no explicit value for that field — real listings mostly
      // hit the fallback branch since sellers only fill brand/condition).
      let matchesExtra = true;
      for (const [key, value] of Object.entries(extraFilters)) {
        if (!value || value === 'All') continue;
        const productVal = (product as any)[key];
        if (productVal !== undefined && productVal !== null && productVal !== '') {
          const cleanProdVal = String(productVal).toLowerCase().trim();
          const cleanFilterVal = String(value).toLowerCase().trim();
          if (cleanProdVal !== cleanFilterVal && !cleanProdVal.includes(cleanFilterVal)) {
            matchesExtra = false;
            break;
          }
        } else {
          const cleanVal = String(value).toLowerCase().trim();
          if (!title.includes(cleanVal) && !description.includes(cleanVal)) {
            matchesExtra = false;
            break;
          }
        }
      }

      return matchesCategory && matchesSearch && matchesMin && matchesMax && matchesBrand && matchesRegion && matchesCity && matchesExtra;
    });

    return sortProductsByRanking(list, users, sortByPrice, sortByAds);
  }, [products, selectedCategory, searchText, minPriceFilter, maxPriceFilter, selectedBrandFilter, extraFilters, selectedRegion, selectedCity, users, sortByPrice, sortByAds]);

  // Matches web's GhanaLocationFilter.tsx regionCounts/cityCounts — per-pill
  // product counts, computed off the full unfiltered `products` list (same
  // source web passes in), not the already-filtered grid. Was entirely
  // absent on mobile: pills gave no indication of how many listings each
  // region/city actually has before tapping into it.
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = { All: products.length };
    products.forEach((p) => {
      const reg = getRegionForLocation(p.location);
      counts[reg] = (counts[reg] || 0) + 1;
    });
    return counts;
  }, [products]);

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (selectedRegion === 'All' || products.length === 0) return counts;
    const activeReg = GHANA_REGIONS.find((r) => r.name === selectedRegion);
    if (!activeReg) return counts;
    products.forEach((p) => {
      if (!p.location) return;
      const locLower = String(p.location).toLowerCase();
      activeReg.cities.forEach((city) => {
        if (locLower.includes(city.toLowerCase())) {
          counts[city] = (counts[city] || 0) + 1;
        }
      });
    });
    return counts;
  }, [products, selectedRegion]);

  const [categoryDisplayLimit, setCategoryDisplayLimit] = useState(24);

  // Reset pagination limit on filter or category change
  useEffect(() => {
    setCategoryDisplayLimit(24);
  }, [selectedCategory, searchText, minPriceFilter, maxPriceFilter, selectedBrandFilter, extraFilters, selectedRegion, selectedCity]);

  const isAllCategories = (selectedCategory === 'All' || !selectedCategory) && !searchText.trim();
  const displayedProducts = useMemo(() => {
    return isAllCategories ? filteredProducts.slice(0, 24) : filteredProducts.slice(0, categoryDisplayLimit);
  }, [isAllCategories, filteredProducts, categoryDisplayLimit]);

  // Featured boosted listings memo — matches web's FeaturedListings.tsx
  // filterAndSortFeatured exactly: active-boost + category filter, sorted by
  // most-recently-boosted first (not a "priorityScore" field, which this
  // component never actually sorts by on web).
  const featuredProducts = useMemo(() => {
    return products
      .filter((p) => {
        if (!p || (p as any).status === 'hidden' || p.isSold) return false;
        if (selectedCategory && selectedCategory !== 'All') {
          if (String(p.category || '').trim().toLowerCase() !== String(selectedCategory).trim().toLowerCase()) return false;
        }
        return isBoostActive(p);
      })
      .sort((a, b) => {
        const aDate = new Date((a.boostStartDate || a.lastBoostedAt || a.createdAt) as string).getTime() || 0;
        const bDate = new Date((b.boostStartDate || b.lastBoostedAt || b.createdAt) as string).getTime() || 0;
        return bDate - aDate;
      });
  }, [products, selectedCategory]);

  const scrollToFeaturedIndex = (index: number) => {
    featuredIndexRef.current = index;
    setFeaturedActiveIndex(index);
    featuredScrollRef.current?.scrollTo({ x: index * FEATURED_CARD_STEP, animated: true });
  };

  // Featured listings auto-swipe every 1.5s — grid-only content, but this
  // had no viewMode guard, so the timer kept ticking (and calling
  // setFeaturedActiveIndex, a HomeScreen state update) every 1.5s even while
  // deep in the Watch Video Ads feed with the carousel not even mounted.
  // HomeScreen is a single huge component — that state update re-renders
  // the whole tree, including recomputing the video feed's renderItem
  // closure, on a timer competing with gesture handling and video state for
  // the JS thread. A prior diagnostic pass (instrumented renderItem) had
  // already shown the feed re-rendering every ~1-1.5s at total rest with no
  // interaction at all — this timer is the direct match for that cadence.
  useEffect(() => {
    if (viewMode !== 'grid' || featuredProducts.length <= 1 || isFeaturedPaused) return;

    const interval = setInterval(() => {
      const nextIndex = (featuredIndexRef.current + 1) % featuredProducts.length;
      scrollToFeaturedIndex(nextIndex);
    }, 1500);

    return () => clearInterval(interval);
  }, [viewMode, featuredProducts.length, isFeaturedPaused]);

  // Reset to the first slide when the featured set changes (category/search change)
  useEffect(() => {
    featuredIndexRef.current = 0;
    setFeaturedActiveIndex(0);
  }, [featuredProducts.length, selectedCategory]);

  // Trending 10 most viewed listings memo
  const trendingProducts = useMemo(
    () => computeTrendingProducts(products, selectedCategory, 10),
    [products, selectedCategory]
  );

  // Personalized "For You" discovery memo (Phase 4A) — computed entirely from
  // products/users already loaded above; zero additional network requests.
  const forYouResult = useMemo(() => {
    return getForYouProducts({
      products,
      users,
      currentUserId: auth.currentUser?.uid,
      selectedCategory,
      limit: 12,
    });
  }, [products, users, selectedCategory]);

  // Sellers to Discover memo (Active Ghanaian merchants with active listings).
  // Matches web's SellersToDiscover.tsx exactly — it accepts a selectedCategory
  // prop but never actually filters by it, so the same top sellers show
  // regardless of the active category filter. Not passing it here on purpose.
  const discoverSellers = useMemo(
    () => computeDiscoverSellers(products, users, undefined, 12),
    [users, products]
  );

  // Only listings with a real video belong in the video ads feed — the
  // previous implementation showed every product's photo with a fake play
  // icon overlay, regardless of whether it actually had a video.
  const videoAdsProducts = useMemo(() => {
    return products.filter((p) => Array.isArray((p as any).videos) && (p as any).videos.length > 0 && (p as any).videos[0]);
  }, [products]);

  // Matches web's VideoAdsFeed loadNextBatch — an effectively endless feed
  // via /api/video-ads pagination + anti-repeat tracking, not a bounded
  // filter over the same 200-product page the main grid uses. Previously
  // mobile's video feed just silently stopped once scrolled past all video
  // items already in that page.
  const [videoFeedItems, setVideoFeedItems] = useState<Product[]>([]);
  const [isLoadingMoreVideos, setIsLoadingMoreVideos] = useState(false);
  const seenVideoIdsRef = useRef<Set<string>>(new Set());

  // No longer gated on viewMode === 'video': videoAdsProducts is already
  // derived from `products`, which loads on Home mount regardless of which
  // mode is showing, so there's no reason to wait for the user to actually
  // open Watch Video Ads before this populates — doing it eagerly is what
  // lets HomePreloadVideos (below) start buffering the first couple of
  // videos while the user is still browsing Classifieds.
  useEffect(() => {
    if (videoFeedItems.length === 0 && videoAdsProducts.length > 0) {
      videoAdsProducts.forEach((p) => seenVideoIdsRef.current.add(p.id));
      console.log('VIDEO_TIMING url_resolved', videoAdsProducts[0]?.id, Date.now());
      setVideoFeedItems(videoAdsProducts);
    }
  }, [videoAdsProducts, videoFeedItems.length]);

  const loadMoreVideoAds = async () => {
    if (isLoadingMoreVideos) return;
    setIsLoadingMoreVideos(true);
    try {
      const more = await fetchVideoAds(5, Array.from(seenVideoIdsRef.current));
      // The server intentionally recycles already-shown products once the
      // real pool is exhausted (so an infinite-scroll feed doesn't just
      // hard-stop) rather than honoring excludeIds forever — reasonable
      // for the feed in general, but appending its response verbatim put
      // the SAME product id into videoFeedItems twice, which gave the
      // FlatList two cells with the identical key. That's not a cosmetic
      // warning: React's reconciliation for a duplicate key is undefined
      // behavior, and it was firing continuously (every recycled batch),
      // which is a real, ongoing contributor to broken/stuck scrolling —
      // not just console noise. Filtering here makes the client correct
      // regardless of what the server does: once truly out of new videos,
      // the feed simply stops growing instead of corrupting its own list.
      const trulyNew = more.filter((p: any) => !seenVideoIdsRef.current.has(p.id));
      if (trulyNew.length > 0) {
        trulyNew.forEach((p: any) => seenVideoIdsRef.current.add(p.id));
        setVideoFeedItems((prev) => [...prev, ...trulyNew]);
      }
    } finally {
      setIsLoadingMoreVideos(false);
    }
  };

  // Used by the hand-rolled video feed UI (which isn't built on ProductCard,
  // so it can't rely on ProductCard's own internal context wiring) — routes
  // through the same shared SavedProducts context as every grid card.
  const handleToggleSave = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please log in under the Profile tab to save deals — bookmarks sync across mobile & web.'
      );
      return;
    }
    try {
      await toggleSavedProduct(product.id);
    } catch (err: any) {
      Alert.alert('Bookmark Failed', err?.message || 'Could not update favorites.');
    }
  };

  // Was pure theater before — a 600ms fake spinner with no actual refetch.
  // watchProducts() only loads once on mount with no polling, so without a
  // real refresh path new listings never appeared until the app restarted.
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [freshResult, freshUsers] = await Promise.all([
        fetchProductsWithStatus(200),
        new Promise<any[]>((resolve) => {
          const unsub = watchUsers((result) => {
            resolve(result);
            unsub();
          });
        }),
      ]);
      // Only replace what's on screen if the refresh actually succeeded —
      // previously this used plain fetchProducts(), which returns [] on
      // failure indistinguishably from a real empty catalog, so a failed
      // pull-to-refresh silently wiped out the products already showing
      // despite the comment here saying otherwise.
      if (!freshResult.failed) {
        setProducts(freshResult.products as Product[]);
        setFeedLoadFailed(false);
      }
      setUsers(freshUsers);
    } catch (err) {
      // keep showing existing data if the refresh fails
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const handleInAppChat = async (product: Product) => {
    try {
      const chatId = await startChatApi(product.id, `Hi, is "${product.title}" still available?`);
      if (chatId) {
        navigation?.navigate('Chats', { activeChatId: chatId });
      }
    } catch (err: any) {
      Alert.alert('Unable to Connect', err?.message || 'Could not start chat with the seller.');
    }
  };

  // Matches web's VideoAdsFeed contact-method modal (WhatsApp direct or
  // in-app chat, gated behind email verification) — mobile previously
  // skipped straight to in-app chat with no WhatsApp option or gate at all.
  const handleStartChat = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please log in or create an account under the Profile tab to start a chat with this seller.'
      );
      return;
    }
    if (product.sellerId === user.uid) {
      Alert.alert('Self-Trade Action', 'You cannot start a chat on your own listing.');
      return;
    }

    const currentUserProfile = users.find((u: any) => u.id === user.uid);
    if (!currentUserProfile?.emailVerified) {
      setVideoFeedBlockedAction(() => () => handleStartChat(product));
      return;
    }

    const sellerUser: any = users.find((u: any) => u.id === product.sellerId);
    const whatsAppRaw = sellerUser?.whatsAppNumber || sellerUser?.phoneNumber;
    if (!whatsAppRaw) {
      handleInAppChat(product);
      return;
    }

    Alert.alert(
      'Contact Seller',
      'How would you like to reach this seller?',
      [
        {
          text: 'WhatsApp',
          onPress: () => {
            let cleanNumber = String(whatsAppRaw).replace(/\D/g, '');
            if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
              cleanNumber = '233' + cleanNumber.substring(1);
            } else if (!cleanNumber.startsWith('233') && cleanNumber.length === 9) {
              cleanNumber = '233' + cleanNumber;
            }
            const msg = encodeURIComponent(`Hello! I'm interested in your listed item "${product.title}" on Tedbuy marketplace. Let's chat!`);
            Linking.openURL(`https://wa.me/${cleanNumber}?text=${msg}`).catch(() => {
              Alert.alert('Error', 'Unable to open WhatsApp on your device.');
            });
          },
        },
        { text: 'TedBuy Chat', onPress: () => handleInAppChat(product) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Matches web's VideoAdsFeed follow-plus badge (previously dead UI on
  // mobile — the avatar/badge weren't even wrapped in a Pressable).
  const [togglingFollowSellerId, setTogglingFollowSellerId] = useState<string | null>(null);
  const [videoFeedBlockedAction, setVideoFeedBlockedAction] = useState<(() => void) | null>(null);
  const handleToggleFollowInVideoFeed = async (sellerId: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Authentication Required', 'Please sign in to follow this seller.');
      return;
    }
    if (togglingFollowSellerId) return;
    try {
      setTogglingFollowSellerId(sellerId);
      await toggleFollowSeller(sellerId, currentUser.uid);
      setUsers((prev) => prev.map((u: any) => {
        if (u.id !== currentUser.uid) return u;
        const following: string[] = Array.isArray(u.followingSellers) ? u.followingSellers : [];
        const next = following.includes(sellerId) ? following.filter((id) => id !== sellerId) : [...following, sellerId];
        return { ...u, followingSellers: next };
      }));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update follow status.');
    } finally {
      setTogglingFollowSellerId(null);
    }
  };

  const handleShare = async (product: Product) => {
    const cleanSlug = (product.title || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const hasPrice = product.price && Number(product.price) > 0;
    const priceText = hasPrice ? ` for GHS ${product.price}` : '';
    const shareUrl = `https://www.tedbuy.store/product/${product.id}-${cleanSlug}?title=${encodeURIComponent(product.title || '')}&price=${hasPrice ? encodeURIComponent(product.price) : ''}`;
    try {
      await Share.share({
        title: product.title,
        message: `Check out "${product.title}"${priceText} on TedBuy Ghana!\n\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (err) {
      // user dismissed the share sheet — nothing to do
    }
  };

  // Horizontal discovery navigation (Classifieds ↔ Watch Video Ads ↔ Seller
  // Store), layered on top of the vertical video-feed swipe without fighting
  // it. activeOffsetX/failOffsetY is the standard react-native-gesture-handler
  // technique for exactly this: the Pan only ACTIVATES once horizontal
  // movement passes ±20px, and FAILS (handing the touch stream to whatever
  // native scroll view is underneath — the vertical video FlatList, or the
  // grid's own vertical FlatList) the moment vertical movement passes ±15px
  // first. Vertical gets the tighter threshold deliberately, since a false
  // activation here would compete with the vertical swipe that took this
  // session multiple rounds to get reliable — biasing toward "let vertical
  // win" is the safe direction to bias in. A plain tap (Save/Chat/mute/pause/
  // etc.) never moves far enough to activate a Pan at all, so none of the
  // existing Pressables are affected.
  const HORIZONTAL_SWIPE_MIN_DISTANCE = 60;
  const HORIZONTAL_SWIPE_MIN_VELOCITY = 400;

  const gridToVideoGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .failOffsetY([-15, 15])
        .onEnd((e) => {
          if (e.translationX < -HORIZONTAL_SWIPE_MIN_DISTANCE && e.velocityX < -HORIZONTAL_SWIPE_MIN_VELOCITY) {
            setViewMode('video');
          }
        }),
    []
  );

  const videoHorizontalGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .failOffsetY([-15, 15])
        .onEnd((e) => {
          if (e.translationX < -HORIZONTAL_SWIPE_MIN_DISTANCE && e.velocityX < -HORIZONTAL_SWIPE_MIN_VELOCITY) {
            const currentSellerId = videoFeedItems[activeVideoIndex]?.sellerId;
            if (currentSellerId) {
              navigation?.navigate('SellerProfile', { sellerId: currentSellerId });
            }
          } else if (e.translationX > HORIZONTAL_SWIPE_MIN_DISTANCE && e.velocityX > HORIZONTAL_SWIPE_MIN_VELOCITY) {
            setViewMode('grid');
          }
        }),
    [videoFeedItems, activeVideoIndex, navigation]
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Zero-size, invisible — see HomePreloadVideos above. Only needed
          before the user has ever opened the real feed; once they have,
          visitedVideoIndicesRef already covers keeping those two videos'
          players alive, so re-running this on every trip back to
          Classifieds would just be a redundant fetch. */}
      {viewMode === 'grid' && !visitedVideoIndicesRef.current.has(0) && (
        <HomePreloadVideos items={videoFeedItems} />
      )}
      {/* Premium Web-aligned top header */}
      <View style={styles.headerContainer}>
        <View style={styles.topBar}>
          <Pressable
            style={styles.topBarLeft}
            onPress={() => {
              // Matches web's logo click: back to the default browse state.
              setSearchText('');
              setSelectedCategory('All');
              setViewMode('grid');
              resetTabBar();
              mainGridRef.current?.scrollToOffset({ offset: 0, animated: true });
            }}
          >
            <View style={styles.brandBadge}>
              <TedBuyLogo size={26} />
            </View>
            <Text style={styles.brandName}>
              Ted<Text style={styles.brandNameAccent}>Buy</Text>
            </Text>
          </Pressable>
          <View style={styles.topBarRight}>
            {/* Matches web's Navbar.tsx "Saved" button exactly — real count
                from savedProductIds (was a static Alert with no real count
                or destination). Opens its own dedicated Saved Deals screen
                rather than landing on the Profile Dashboard's shared scroll
                (matches web's own separate "Saved" tab being one tap away,
                not something you have to scroll past your listings to reach). */}
            <Pressable
              style={styles.bookmarkBadge}
              onPress={() => navigation?.navigate('SavedProducts')}
            >
              <Bookmark size={16} color="#ffffff" strokeWidth={2.2} fill={savedProductIds.length ? '#fda4af' : 'none'} />
              {savedProductIds.length > 0 && (
                <View style={styles.bookmarkCountBadge}>
                  <Text style={styles.bookmarkCountBadgeText}>{savedProductIds.length}</Text>
                </View>
              )}
            </Pressable>
            {auth.currentUser ? (
              // Matches web's icon-only "My Listings" dashboard shortcut
              // (Navbar.tsx nav-btn-dashboard, LayoutDashboard icon) — was a
              // plain "My Account" text button that just opened whatever tab
              // Profile last happened to be on.
              <Pressable
                onPress={() => navigation?.navigate('Profile', { tab: 'dashboard' })}
                style={styles.dashboardIconBtn}
              >
                <LayoutDashboard size={18} color="#0f172a" strokeWidth={2.2} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => navigation?.navigate('Profile')}
                style={styles.loginBtn}
              >
                <Text style={styles.loginBtnText}>→ Log In</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Main body of the screen */}
      <View style={styles.body}>
        {viewMode === 'grid' ? (
          <GestureDetector gesture={gridToVideoGesture}>
          <AnimatedFlatList
            ref={mainGridRef}
            key="grid-2-cols"
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            data={displayedProducts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            onScroll={onTabBarScroll}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#0f172a" colors={['#0f172a']} />
            }
            onScrollToIndexFailed={(info) => {
              // Standard RN fallback: without getItemLayout, scrollToIndex can fail
              // before enough items have been measured — approximate with an offset,
              // then retry the precise scroll once layout has caught up.
              mainGridRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              setTimeout(() => {
                mainGridRef.current?.scrollToIndex({ index: info.index, animated: true });
              }, 150);
            }}
            ListHeaderComponent={
              <View>
                {/* Search Container matching Web App "LOOKING FOR SOMETHING?" card */}
                <View style={styles.searchBoxCard}>
                  <Text style={styles.searchLabel}>LOOKING FOR SOMETHING?</Text>
                  <View style={styles.searchRow}>
                    <Text style={styles.searchEmoji}>🔍</Text>
                    <TextInput
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholder="Search phones, laptops, sneakers..."
                      style={styles.input}
                      placeholderTextColor="#64748b"
                    />
                  </View>
                </View>

                {/* Pill Toggle Switcher for Standard Grid / Watch Video Ads —
                    matches web's App.tsx tabs (LayoutGrid / Video icons,
                    emerald fill on the video icon). */}
                <View style={styles.toggleCapsule}>
                  <Pressable
                    onPress={() => setViewMode('grid')}
                    style={[styles.toggleBtn, viewMode === 'grid' && styles.toggleBtnActive]}
                  >
                    <LayoutGrid size={18} color={viewMode === 'grid' ? '#ffffff' : '#64748b'} strokeWidth={2.4} />
                    <Text style={[styles.toggleBtnText, viewMode === 'grid' && styles.toggleBtnTextActive]}>Standard Grid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { console.log('VIDEO_TIMING feed_open', videoFeedItems[0]?.id, Date.now()); setViewMode('video'); }}
                    style={[styles.toggleBtn, viewMode === 'video' && styles.toggleBtnActive]}
                  >
                    <Video size={19} color="#10b981" fill="#10b981" strokeWidth={1.6} />
                    <Text style={[styles.toggleBtnText, viewMode === 'video' && styles.toggleBtnTextActive]}>Watch Video Ads</Text>
                  </Pressable>
                </View>

                {/* Explore Marketplace Categories Section Header */}
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionHeaderLeft}>
                    <TrendingUp size={16} color="#0f172a" strokeWidth={2.3} />
                    <Text style={styles.sectionHeaderTitle}>Explore Marketplace Categories</Text>
                  </View>
                  <Pressable onPress={() => setShowAllCategories((prev) => !prev)} style={styles.viewAllBtn}>
                    <Text style={styles.viewAllText}>{showAllCategories ? 'Show Scroll' : 'View All Grid'}</Text>
                  </Pressable>
                </View>

                {/* Categories row — horizontal scroll by default, or a full
                    wrapped grid when "View All Grid" is toggled (matches web). */}
                {showAllCategories ? (
                  <View style={[styles.categoryRow, styles.categoryGridWrap]}>
                    {categories.map((category) => {
                      const active = selectedCategory === category;
                      return (
                        <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                          <Text style={styles.categoryIcon}>{categoryIcons[category] || '📦'}</Text>
                          <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                            {category === 'All' ? 'All Categories' : category}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ height: 48, marginBottom: 16 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                      {categories.map((category) => {
                        const active = selectedCategory === category;
                        return (
                          <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                            <Text style={styles.categoryIcon}>{categoryIcons[category] || '📦'}</Text>
                            <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                              {category === 'All' ? 'All Categories' : category}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Category Filter Dropdown (e.g. FILTER PHONES) */}
                {selectedCategory !== 'All' && (
                  <View style={styles.categoryFilterDropdownContainer}>
                    <Pressable
                      style={styles.categoryFilterDropdownHeader}
                      onPress={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                    >
                      <View style={styles.categoryFilterHeaderLeft}>
                        <View style={styles.categoryFilterIconBadge}>
                          <Text style={{ fontSize: 13 }}>⚙️</Text>
                        </View>
                        <Text style={styles.categoryFilterTitle}>
                          FILTER {selectedCategory.toUpperCase()}
                        </Text>
                        {(minPriceFilter || maxPriceFilter || selectedBrandFilter || Object.values(extraFilters).some((v) => v && v !== 'All')) ? (
                          <View style={styles.activeFilterCountBadge}>
                            <Text style={styles.activeFilterCountText}>Active</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.categoryFilterHeaderRight}>
                        <View style={[styles.filterTogglePill, isFilterDropdownOpen && styles.filterTogglePillOpen]}>
                          <Text style={[styles.filterTogglePillText, isFilterDropdownOpen && styles.filterTogglePillTextOpen]}>
                            {isFilterDropdownOpen ? 'Hide' : 'Filter'}
                          </Text>
                          <Text style={[styles.filterTogglePillChevron, isFilterDropdownOpen && styles.filterTogglePillChevronOpen]}>
                            {isFilterDropdownOpen ? '▲' : '▼'}
                          </Text>
                        </View>
                      </View>
                    </Pressable>

                    {/* Expandable Body */}
                    {isFilterDropdownOpen && (
                      <View style={styles.categoryFilterBody}>
                        {/* Quick promo shortcut chips — matches web's
                            DynamicCategoryFilters.tsx promo banners. */}
                        {promoBanners.length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={[styles.locationPillRow, { marginBottom: 4 }]}
                          >
                            {promoBanners.map((banner) => (
                              <Pressable key={banner.title} onPress={banner.action} style={styles.promoBannerChip}>
                                <Text style={styles.promoBannerChipIcon}>{banner.icon}</Text>
                                <Text style={styles.promoBannerChipText}>{banner.title}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        )}

                        {/* Price Range inputs */}
                        <Text style={styles.filterSectionMiniTitle}>PRICE RANGE (GH₵)</Text>
                        {/* Quick price-range presets — matches web's
                            priceRanges chips (DynamicCategoryFilters.tsx). */}
                        <View style={styles.pricePresetGrid}>
                          {priceRangePresets.map((range) => {
                            const isSelected = minPriceFilter === range.min && maxPriceFilter === range.max;
                            return (
                              <Pressable
                                key={range.label}
                                onPress={() => {
                                  if (isSelected) {
                                    setMinPriceFilter('');
                                    setMaxPriceFilter('');
                                  } else {
                                    setMinPriceFilter(range.min);
                                    setMaxPriceFilter(range.max);
                                  }
                                }}
                                style={[styles.pricePresetChip, isSelected && styles.pricePresetChipActive]}
                              >
                                <Text style={[styles.pricePresetChipText, isSelected && styles.pricePresetChipTextActive]} numberOfLines={1}>
                                  {range.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.priceFilterRow}>
                          <TextInput
                            placeholder="Min GH₵"
                            placeholderTextColor="#94a3b8"
                            keyboardType="numeric"
                            value={minPriceFilter}
                            onChangeText={setMinPriceFilter}
                            style={styles.priceInputBox}
                          />
                          <Text style={styles.priceRangeDash}>-</Text>
                          <TextInput
                            placeholder="Max GH₵"
                            placeholderTextColor="#94a3b8"
                            keyboardType="numeric"
                            value={maxPriceFilter}
                            onChangeText={setMaxPriceFilter}
                            style={styles.priceInputBox}
                          />
                        </View>

                        {/* Category-specific extra filter fields — matches
                            web's DynamicCategoryFilters.tsx. Each field is a
                            horizontal chip row; selecting "model" only shows
                            once a brand is picked, for fields that dependsOn
                            brand, matching web's dependent-dropdown behavior. */}
                        {(CATEGORY_FILTERS[selectedCategory] || []).map((field) => {
                          if (field.dependsOn && !extraFilters[field.dependsOn]) return null;
                          const options = field.dependsOn
                            ? getModelsForBrand(extraFilters[field.dependsOn], selectedCategory)
                            : (field.options || []);
                          if (field.dependsOn && options.length === 0) return null;
                          return (
                            <View key={field.id} style={{ marginTop: 12 }}>
                              <Text style={styles.filterSectionMiniTitle}>{field.label.toUpperCase()}</Text>
                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.locationPillRow}
                              >
                                <Pressable
                                  style={[styles.locationPill, !extraFilters[field.id] && styles.locationPillActive]}
                                  onPress={() => setExtraFilters((prev) => {
                                    const next = { ...prev };
                                    delete next[field.id];
                                    return next;
                                  })}
                                >
                                  <Text style={[styles.locationPillText, !extraFilters[field.id] && styles.locationPillTextActive]}>All</Text>
                                </Pressable>
                                {options.map((opt) => (
                                  <Pressable
                                    key={opt}
                                    style={[styles.locationPill, extraFilters[field.id] === opt && styles.locationPillActive]}
                                    onPress={() => setExtraFilters((prev) => {
                                      const next = { ...prev, [field.id]: opt };
                                      // Clear any field that dependsOn this one (e.g. model
                                      // when brand changes) since its option list just changed.
                                      (CATEGORY_FILTERS[selectedCategory] || []).forEach((f) => {
                                        if (f.dependsOn === field.id) delete next[f.id];
                                      });
                                      return next;
                                    })}
                                  >
                                    <Text style={[styles.locationPillText, extraFilters[field.id] === opt && styles.locationPillTextActive]}>{opt}</Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          );
                        })}

                        {/* Reset and Apply Row */}
                        <View style={styles.filterActionRow}>
                          {(minPriceFilter || maxPriceFilter || selectedBrandFilter || Object.values(extraFilters).some((v) => v && v !== 'All')) ? (
                            <Pressable
                              style={styles.filterResetBtn}
                              onPress={() => {
                                setMinPriceFilter('');
                                setMaxPriceFilter('');
                                setSelectedBrandFilter('');
                                setExtraFilters({});
                              }}
                            >
                              <Text style={styles.filterResetBtnText}>Reset</Text>
                            </Pressable>
                          ) : <View />}
                          <Pressable
                            style={styles.filterApplyBtn}
                            onPress={() => setIsFilterDropdownOpen(false)}
                          >
                            <Text style={styles.filterApplyBtnText}>Show Results</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* Ghana Location Filters block */}
                <View style={styles.locationFilterCard}>
                  <Pressable
                    style={styles.locationFilterHeader}
                    onPress={() => setIsLocationDropdownOpen((prev) => !prev)}
                  >
                    <View style={styles.locationLeft}>
                      <MapPin size={16} color="#0f172a" strokeWidth={2.2} style={{ marginRight: 8 }} />
                      <Text style={styles.locationTitle}>Ghana Location Filters</Text>
                    </View>
                    <View style={styles.locationRight}>
                      <View style={styles.locationBadge}>
                        <Text style={styles.locationBadgeText} numberOfLines={1}>
                          {selectedRegion === 'All' ? 'All' : `${selectedRegion}${selectedCity !== 'All' ? ' - ' + selectedCity : ''}`}
                        </Text>
                      </View>
                      {isLocationDropdownOpen ? (
                        <ChevronUp size={16} color="#64748b" strokeWidth={2.3} />
                      ) : (
                        <ChevronDown size={16} color="#64748b" strokeWidth={2.3} />
                      )}
                    </View>
                  </Pressable>

                  {isLocationDropdownOpen && (
                    <View style={styles.locationDropdownBody}>
                      <View style={styles.locationDropdownHeaderRow}>
                        <Text style={styles.filterSectionMiniTitle}>FILTER BY REGION</Text>
                        {(selectedRegion !== 'All' || selectedCity !== 'All') && (
                          <Pressable
                            style={styles.locationResetBtn}
                            onPress={() => {
                              setSelectedRegion('All');
                              setSelectedCity('All');
                            }}
                          >
                            <X size={11} color="#dc2626" strokeWidth={2.5} />
                            <Text style={styles.locationResetBtnText}>Reset</Text>
                          </Pressable>
                        )}
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.locationPillRow}
                      >
                        <Pressable
                          style={[styles.locationPill, selectedRegion === 'All' && styles.locationPillActive]}
                          onPress={() => { setSelectedRegion('All'); setSelectedCity('All'); }}
                        >
                          <Text style={[styles.locationPillText, selectedRegion === 'All' && styles.locationPillTextActive]}>All Regions</Text>
                        </Pressable>
                        {GHANA_REGIONS.map((region) => (
                          <Pressable
                            key={region.name}
                            style={[styles.locationPill, selectedRegion === region.name && styles.locationPillActive]}
                            onPress={() => { setSelectedRegion(region.name); setSelectedCity('All'); }}
                          >
                            <Text style={[styles.locationPillText, selectedRegion === region.name && styles.locationPillTextActive]}>{region.name}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>

                      {selectedRegion !== 'All' && (
                        <>
                          <Text style={[styles.filterSectionMiniTitle, { marginTop: 10 }]}>
                            FILTER BY CITY IN {selectedRegion.toUpperCase()}
                          </Text>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.locationPillRow}
                          >
                            <Pressable
                              style={[styles.locationPill, selectedCity === 'All' && styles.locationPillActive]}
                              onPress={() => setSelectedCity('All')}
                            >
                              <Text style={[styles.locationPillText, selectedCity === 'All' && styles.locationPillTextActive]}>All Cities</Text>
                            </Pressable>
                            {GHANA_REGIONS.find((r) => r.name === selectedRegion)?.cities.map((city) => (
                              <Pressable
                                key={city}
                                style={[styles.locationPill, selectedCity === city && styles.locationPillActive]}
                                onPress={() => setSelectedCity(city)}
                              >
                                <Text style={[styles.locationPillText, selectedCity === city && styles.locationPillTextActive]}>{city}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        </>
                      )}
                    </View>
                  )}
                </View>

                {/* Recently Viewed Panel — matches web's App.tsx (src/App.tsx
                    ~line 1107), placed near the top of the feed. */}
                {recentlyViewedProducts.length > 0 && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <History size={16} color="#475569" strokeWidth={2.2} />
                        <Text style={styles.carouselTitle}>Recently Viewed</Text>
                      </View>
                      <Pressable onPress={clearRecentlyViewed} style={styles.carouselViewAllBtn}>
                        <Text style={styles.carouselViewAllText}>Clear</Text>
                      </Pressable>
                    </View>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalCarouselContainer}
                    >
                      {recentlyViewedProducts.map((item) => (
                        <View key={`recent-${item.id}`} style={styles.carouselCardItem}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                            isFeaturedVariant={true}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Featured Boosted Listings Carousel — matches web's home
                    page order: Featured, then For You, then Sellers to
                    Discover, then Trending Ads (src/App.tsx). */}
                {featuredProducts.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Flame size={16} color="#f59e0b" fill="#f59e0b" strokeWidth={2} />
                        <Text style={styles.carouselTitle}>Featured Listings</Text>
                      </View>
                      <Pressable
                        onPress={() => navigation?.navigate('FeaturedListings', { category: selectedCategory })}
                        style={styles.carouselViewAllBtn}
                      >
                        <Text style={styles.carouselViewAllText}>View all ›</Text>
                      </Pressable>
                    </View>
                    <ScrollView
                      ref={featuredScrollRef}
                      horizontal
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalCarouselContainer}
                      onScrollBeginDrag={() => {
                        setIsFeaturedPaused(true);
                        if (featuredPauseTimeoutRef.current) clearTimeout(featuredPauseTimeoutRef.current);
                      }}
                      onScrollEndDrag={() => {
                        if (featuredPauseTimeoutRef.current) clearTimeout(featuredPauseTimeoutRef.current);
                        featuredPauseTimeoutRef.current = setTimeout(() => {
                          setIsFeaturedPaused(false);
                        }, 2500);
                      }}
                      onMomentumScrollEnd={(e) => {
                        const rawIndex = Math.round(e.nativeEvent.contentOffset.x / FEATURED_CARD_STEP);
                        const clamped = Math.min(Math.max(0, rawIndex), featuredProducts.length - 1);
                        featuredIndexRef.current = clamped;
                        setFeaturedActiveIndex(clamped);
                      }}
                    >
                      {featuredProducts.map((item) => (
                        <View key={`featured-${item.id}`} style={styles.carouselCardItem}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                            isFeaturedVariant={true}
                          />
                        </View>
                      ))}
                    </ScrollView>

                    {/* Pagination dots — matches web's centered dot indicators */}
                    {featuredProducts.length > 1 && (
                      <View style={styles.featuredDotsRow}>
                        {featuredProducts.map((_, i) => (
                          <Pressable
                            key={`featured-dot-${i}`}
                            onPress={() => {
                              setIsFeaturedPaused(true);
                              if (featuredPauseTimeoutRef.current) clearTimeout(featuredPauseTimeoutRef.current);
                              scrollToFeaturedIndex(i);
                              featuredPauseTimeoutRef.current = setTimeout(() => setIsFeaturedPaused(false), 2500);
                            }}
                            hitSlop={6}
                            style={featuredActiveIndex === i ? styles.featuredDotActive : styles.featuredDot}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Personalized "For You" discovery Carousel (Phase 4A) */}
                {forYouResult.items.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Text style={styles.carouselTitle}>{forYouResult.headline}</Text>
                      </View>
                      <Pressable
                        onPress={() => navigation?.navigate('ForYou')}
                        style={styles.carouselViewAllBtn}
                      >
                        <Text style={styles.carouselViewAllText}>View all ›</Text>
                      </Pressable>
                    </View>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalCarouselContainer}
                    >
                      {forYouResult.items.map((item) => (
                        <View key={`for-you-${item.id}`} style={styles.carouselCardItem}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Sellers to Discover Section (Active Ghanaian Merchants & Storefronts) */}
                {discoverSellers.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <Store size={16} color="#0f172a" strokeWidth={2.2} />
                        <Text style={styles.carouselTitle}>Popular Stores</Text>
                        <View style={styles.verifiedCountBadge}>
                          <Text style={styles.verifiedCountBadgeText}>{discoverSellers.length}</Text>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => navigation?.navigate('DiscoverSellers')}
                        style={styles.carouselViewAllBtn}
                      >
                        <Text style={styles.carouselViewAllText}>View all ›</Text>
                      </Pressable>
                    </View>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.horizontalCarouselContainer}
                    >
                      {discoverSellers.map((seller) => (
                        <SellerCard
                          key={`seller-card-${seller.id}`}
                          seller={seller}
                          onPress={() => navigation?.navigate('SellerProfile', { sellerId: seller.id })}
                          style={styles.sellerDiscoverCard}
                        />
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Trending Ads Carousel (Top 10 Most Viewed Items) */}
                {trendingProducts.length > 0 && !searchText.trim() && (
                  <View style={styles.carouselSection}>
                    <View style={styles.carouselHeaderRow}>
                      <View style={styles.carouselHeaderLeft}>
                        <TrendingUp size={16} color="#0f172a" strokeWidth={2.3} />
                        <Text style={styles.carouselTitle}>Trending Ads</Text>
                      </View>
                      <Pressable
                        onPress={() => navigation?.navigate('TrendingListings')}
                        style={styles.carouselViewAllBtn}
                      >
                        <Text style={styles.carouselViewAllText}>View all ›</Text>
                      </Pressable>
                    </View>
                    <ScrollView 
                      horizontal 
                      nestedScrollEnabled={true}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      showsHorizontalScrollIndicator={false} 
                      contentContainerStyle={styles.horizontalCarouselContainerSmall}
                    >
                      {trendingProducts.map((item) => (
                        <View key={`trending-${item.id}`} style={styles.carouselCardItemSmall}>
                          <ProductCard
                            product={item}
                            onPress={() => onOpenProduct(item)}
                            onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                            isTrendingVariant={true}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Latest Deals section */}
                <View style={styles.dealsHeaderRow}>
                  <Text style={styles.dealsTitle}>Latest Deals</Text>
                  <Pressable style={styles.refreshButton} onPress={handleRefresh} disabled={isRefreshing}>
                    {isRefreshing ? (
                      <ActivityIndicator size="small" color="#0f172a" />
                    ) : (
                      <RefreshCw size={15} color="#0f172a" strokeWidth={2.2} />
                    )}
                  </Pressable>
                </View>

                {/* Sort Ads / Sort Price bar — matches web's two side-by-side
                    dropdowns (App.tsx); previously a hardcoded, non-functional
                    "Newest First" label with no sorting behind it. Options
                    open in a Modal rather than an absolute-positioned View —
                    this header sits inside the FlatList's scrollable content,
                    so an absolute dropdown here renders behind the grid items
                    below it instead of above them. */}
                <View style={styles.sortBar}>
                  <Pressable style={styles.sortPill} onPress={() => setIsSortMenuOpen('ads')}>
                    <Text style={styles.sortText}>Sort Ads: <Text style={styles.sortValue}>{sortByAds === 'newest' ? 'Newest First' : 'Oldest First'}</Text></Text>
                    <ChevronDown size={13} color="#64748b" strokeWidth={2.3} />
                  </Pressable>

                  <Pressable style={styles.sortPill} onPress={() => setIsSortMenuOpen('price')}>
                    <Text style={styles.sortText}>Sort Price: <Text style={styles.sortValue}>
                      {sortByPrice === 'default' ? 'All Prices' : sortByPrice === 'asc' ? 'Low to High' : 'High to Low'}
                    </Text></Text>
                    <ChevronDown size={13} color="#64748b" strokeWidth={2.3} />
                  </Pressable>
                </View>
              </View>
            }
            ListEmptyComponent={
              loading ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator size="large" color="#0f172a" />
                </View>
              ) : feedLoadFailed ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateTitle}>Couldn't load listings.</Text>
                  <Text style={styles.emptyStateText}>Check your connection and try again.</Text>
                  <Pressable style={styles.emptyStateRetryBtn} onPress={handleRefresh} disabled={isRefreshing}>
                    {isRefreshing ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.emptyStateRetryText}>Try Again</Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateTitle}>No listings match your search.</Text>
                  <Text style={styles.emptyStateText}>Try a different category or search term.</Text>
                </View>
              )
            }
            renderItem={({ item }) => (
              <ProductCard
                product={item}
                onPress={() => onOpenProduct(item)}
                onSellerPress={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
              />
            )}
            onEndReached={() => {
              if (!isAllCategories && displayedProducts.length < filteredProducts.length) {
                setCategoryDisplayLimit((prev) => prev + 24);
              }
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              !isAllCategories && displayedProducts.length < filteredProducts.length ? (
                <View style={styles.loadMoreContainer}>
                  <Pressable
                    onPress={() => setCategoryDisplayLimit((prev) => prev + 24)}
                    style={styles.loadMoreBtn}
                  >
                    <Text style={styles.loadMoreText}>
                      Load More (+{Math.min(24, filteredProducts.length - displayedProducts.length)} more)
                    </Text>
                  </Pressable>
                </View>
              ) : null
            }
          />
          </GestureDetector>
        ) : loading ? (
          <View style={styles.videoFeedEmptyState}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : videoAdsProducts.length === 0 && videoFeedItems.length === 0 ? (
          <View style={styles.videoFeedEmptyState}>
            <Text style={styles.videoFeedEmptyEmoji}>🎥</Text>
            <Text style={styles.videoFeedEmptyTitle}>No video ads yet</Text>
            <Text style={styles.videoFeedEmptyText}>
              Sellers haven't posted any video listings yet. Check back soon, or record your own from the Sell tab!
            </Text>
          </View>
        ) : (
          /* IMMERSIVE VIDEO ADS FEED (Swiper/Reels style) — real playback, only
             for listings that actually have a video. */
          <GestureDetector gesture={videoHorizontalGesture}>
          <View
            style={styles.videoFeedContainer}
            onLayout={(e) => setVideoFeedHeight(e.nativeEvent.layout.height)}
          >
            {videoFeedHeight > 0 && (
            <AnimatedFlatList
              data={videoFeedItems}
              // Standard Grid <-> Watch Video Ads is a conditional render,
              // not a screen navigation — switching to Grid and back
              // unmounts and remounts this exact FlatList, but
              // activeVideoIndex (state on the parent) survives that
              // remount untouched. Without this, the list always visually
              // restarts at index 0 while isActive/shouldLoad logic below
              // kept pointing at wherever you'd scrolled to, so the WRONG
              // video (an off-screen one, by the stale index) would
              // autoplay against what you could actually see, and the
              // on-screen video sat outside the preload window until the
              // next viewability tick corrected it — precisely the kind of
              // glitch a returning user would read as "the feed is broken."
              initialScrollIndex={Math.min(activeVideoIndex, Math.max(0, videoFeedItems.length - 1))}
              // The FlatList had no explicit style, so it never had a
              // guaranteed viewport bounded to exactly one page — needed for
              // pagingEnabled below to page against the right size.
              style={styles.videoFeedList}
              keyExtractor={(item) => `video-${item.id}`}
              showsVerticalScrollIndicator={false}
              viewabilityConfig={videoViewabilityConfig}
              onViewableItemsChanged={onVideoViewableItemsChanged}
              onScroll={onTabBarScroll}
              scrollEventThrottle={16}
              getItemLayout={(_, index) => ({ length: videoFeedHeight, offset: videoFeedHeight * index, index })}
              // pagingEnabled (not snapToInterval) is the fix for swipes
              // that don't register: measured live on-device, a fast, short
              // drag (~1400px in 300ms — well past any real fling velocity)
              // only moved the content ~33% of one page before letting go,
              // and with snapToInterval that ALWAYS snaps back to the
              // start — Android's snapToInterval decides purely from final
              // release position relative to the interval, ignoring
              // velocity. pagingEnabled hands paging to the native
              // ScrollView, which does fling-aware paging (a fast flick
              // advances a page even from a small drag) — the standard
              // "feels effortless" TikTok/Reels behavior this needs.
              pagingEnabled
              decelerationRate="fast"
              onEndReached={loadMoreVideoAds}
              onEndReachedThreshold={1.5}
              // windowSize is the actual gate on "does scrolling back to an
              // already-watched video avoid a re-fetch": shouldLoadVideo
              // (below) keeps a visited item's player alive indefinitely,
              // but that's moot if FlatList itself unmounts the cell first
              // — windowSize, not shouldLoad, decides which cells stay
              // mounted at all. Back at RN's own default (21) rather than
              // the tighter 5 used before, now that doing so is cheap: a
              // mounted-but-not-shouldLoad cell is just a poster Image
              // (shouldLoad, not windowSize, is what gates ever creating a
              // real native player — see the VideoFeedPlayer comment up
              // top), so a wider window costs some extra lightweight Image
              // views, not extra decoders. This still isn't literally
              // "every video for the whole session" — scroll far enough
              // past a video and its cell eventually leaves even this
              // window and unmounts for real — but it comfortably covers
              // scrolling back through everything recently watched, which
              // is what "scroll back and it's already there" means in
              // practice. Deliberately NOT paired with
              // removeClippedSubviews, which is what actually broke
              // scrolling in an earlier round (its view-recycling fights
              // native video decoders on iOS).
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              windowSize={21}
              renderItem={({ item, index }) => {
                const currentUserId = auth.currentUser?.uid;
                const sellerProfile: any = users.find((u: any) => u.id === item.sellerId);
                const isOwnVideoItem = !!currentUserId && item.sellerId === currentUserId;
                const myProfile: any = currentUserId ? users.find((u: any) => u.id === currentUserId) : null;
                const isFollowingSeller = Array.isArray(myProfile?.followingSellers) && myProfile.followingSellers.includes(item.sellerId);
                // Active-only loading (no preload at all) measurably fixed
                // the active video's own load time — live-measured
                // readyToPlay dropped from 5.48s (competing with a
                // concurrent next-item download) to 2.75s. But that traded
                // away the other half of the ask: every single swipe forward
                // then cold-starts from zero, which reads as "the video
                // always takes forever," and scrolling back re-fetches a
                // video already watched moments ago. Both are real product
                // requirements, not just a performance number, so this now
                // preloads the next 2 items ahead (bearing the same
                // bandwidth-sharing cost that measurement found — accepted
                // deliberately here in exchange for "swipe forward never
                // waits") AND never tears down a player for an index once
                // it's been visited, so scrolling back finds it already
                // loaded, muted-but-ready, replayable with zero network.
                // "Visited" is permanent for the life of the screen, not
                // just the current windowSize neighborhood — see
                // visitedVideoIndicesRef above and the widened windowSize
                // below, which is what actually keeps a visited item's cell
                // (and thus its player) from being virtualized away as the
                // user keeps scrolling forward past it.
                const shouldLoadVideo =
                  (index >= activeVideoIndex && index <= activeVideoIndex + 2) ||
                  visitedVideoIndicesRef.current.has(index);
                return (
                  <VideoFeedRow
                    item={item}
                    height={videoFeedHeight}
                    isActive={index === activeVideoIndex && isHomeScreenFocused}
                    shouldLoad={shouldLoadVideo}
                    isMuted={isVideoFeedMuted}
                    isSaved={isSavedProduct(item.id)}
                    sellerProfile={sellerProfile}
                    isOwnVideoItem={isOwnVideoItem}
                    isFollowingSeller={isFollowingSeller}
                    isTogglingFollow={togglingFollowSellerId === item.sellerId}
                    onToggleMute={() => setIsVideoFeedMuted((prev) => !prev)}
                    onOpenSeller={(sellerId) => navigation?.navigate('SellerProfile', { sellerId })}
                    onToggleFollow={handleToggleFollowInVideoFeed}
                    onToggleSave={handleToggleSave}
                    onStartChat={handleStartChat}
                    onShare={handleShare}
                    onOpenProductPress={onOpenProduct}
                  />
                );
              }}
            />
            )}
          </View>
          </GestureDetector>
        )}
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={isSortMenuOpen !== null}
        onRequestClose={() => setIsSortMenuOpen(null)}
      >
        <Pressable style={styles.sortModalOverlay} onPress={() => setIsSortMenuOpen(null)}>
          <Pressable style={styles.sortModalCard} onPress={() => {}}>
            <Text style={styles.sortModalTitle}>{isSortMenuOpen === 'ads' ? 'Sort Ads' : 'Sort Price'}</Text>
            {(isSortMenuOpen === 'ads'
              ? ([['newest', 'Newest First'], ['oldest', 'Oldest First']] as const)
              : ([['default', 'All Prices'], ['asc', 'Low to High'], ['desc', 'High to Low']] as const)
            ).map(([value, label]) => {
              const active = isSortMenuOpen === 'ads' ? sortByAds === value : sortByPrice === value;
              return (
                <Pressable
                  key={value}
                  style={styles.sortOption}
                  onPress={() => {
                    if (isSortMenuOpen === 'ads') setSortByAds(value as 'newest' | 'oldest');
                    else setSortByPrice(value as 'default' | 'asc' | 'desc');
                    setIsSortMenuOpen(null);
                  }}
                >
                  {active && <Check size={14} color="#0f172a" strokeWidth={3} />}
                  <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <EmailVerificationModal
        visible={videoFeedBlockedAction !== null}
        actionType="chat"
        onClose={() => setVideoFeedBlockedAction(null)}
        onVerified={() => {
          const action = videoFeedBlockedAction;
          setVideoFeedBlockedAction(null);
          if (action) action();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  headerContainer: { backgroundColor: '#0f172a', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#020617' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topBarLeft: { flexDirection: 'row', alignItems: 'center' },
  brandBadge: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#020617', borderColor: '#1e293b', borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  brandName: { color: '#ffffff', fontSize: 20, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  brandNameAccent: { color: '#ea580c' },
  topBarRight: { flexDirection: 'row', alignItems: 'center' },
  bookmarkBadge: { marginRight: 12, width: 34, height: 34, borderRadius: 8, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  bookmarkCountBadge: { position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#f43f5e', borderWidth: 1.5, borderColor: '#0f172a', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  bookmarkCountBadgeText: { color: '#ffffff', fontSize: 9, fontFamily: fonts.extrabold },
  dashboardIconBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  loginBtn: { backgroundColor: '#ffffff', paddingHorizontal: 14, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  loginBtnText: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 12 },

  body: { flex: 1, backgroundColor: '#f8fafc' },
  listContent: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 24 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 4 },

  /* Search Card component styled like Web App */
  searchBoxCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 14,
  },
  searchLabel: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: fonts.extrabold,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    height: 44,
  },
  searchEmoji: { fontSize: 16, marginRight: 8, color: '#64748b' },
  input: { flex: 1, fontSize: 14, color: '#0f172a', fontFamily: fonts.medium },

  /* Capsule Switcher component styled like Web App */
  toggleCapsule: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 5,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 48,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  toggleBtnActive: {
    backgroundColor: '#0f172a',
  },
  toggleBtnText: {
    color: '#334155',
    fontFamily: fonts.extrabold,
    fontSize: 14.5,
  },
  toggleBtnTextActive: {
    color: '#ffffff',
    fontFamily: fonts.extrabold,
  },

  /* Categories block matching Web App */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  viewAllBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  viewAllText: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
  },
  categoryRow: { paddingBottom: 6 },
  categoryGridWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 16 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  categoryChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  categoryIcon: { fontSize: 13, marginRight: 6 },
  categoryText: { color: '#475569', fontFamily: fonts.bold, fontSize: 12 },
  categoryTextActive: { color: '#fff', fontFamily: fonts.extrabold },

  /* Category Filter Dropdown Card */
  categoryFilterDropdownContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  categoryFilterDropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  categoryFilterHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryFilterIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  categoryFilterTitle: {
    fontSize: 13,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  activeFilterCountBadge: {
    backgroundColor: '#10b981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 6,
  },
  activeFilterCountText: {
    color: '#ffffff',
    fontSize: 10,
    fontFamily: fonts.extrabold,
  },
  categoryFilterHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  filterTogglePillOpen: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  filterTogglePillText: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: '#065f46',
    marginRight: 4,
  },
  filterTogglePillTextOpen: {
    color: '#ffffff',
  },
  filterTogglePillChevron: {
    fontSize: 9,
    color: '#059669',
  },
  filterTogglePillChevronOpen: {
    color: '#34d399',
  },
  categoryFilterBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  filterSectionMiniTitle: {
    fontSize: 9.5,
    fontFamily: fonts.extrabold,
    color: '#64748b',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  priceFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pricePresetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  pricePresetChip: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, minWidth: '47%', alignItems: 'center' },
  pricePresetChipActive: { backgroundColor: '#10b981', borderColor: '#10b981' },
  pricePresetChipText: { color: '#475569', fontSize: 10, fontFamily: fonts.bold },
  pricePresetChipTextActive: { color: '#ffffff', fontFamily: fonts.extrabold },
  priceInputBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: '#0f172a',
    fontFamily: fonts.semibold,
  },
  priceRangeDash: {
    marginHorizontal: 8,
    color: '#94a3b8',
    fontFamily: fonts.bold,
  },
  filterActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  filterResetBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  filterResetBtnText: {
    color: '#dc2626',
    fontSize: 11,
    fontFamily: fonts.extrabold,
  },
  filterApplyBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    marginLeft: 'auto',
  },
  filterApplyBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: fonts.extrabold,
  },

  /* Ghana Location Filter Card component styled like Web App */
  locationFilterCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    marginBottom: 16,
    overflow: 'hidden',
  },
  locationFilterHeader: {
    flexDirection: 'row',
    height: 52,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  locationTitle: { color: '#0f172a', fontSize: 13.5, fontFamily: fonts.extrabold, letterSpacing: -0.2 },
  locationRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, maxWidth: 120 },
  locationBadgeText: { color: '#64748b', fontSize: 11, fontFamily: fonts.bold },
  locationDropdownBody: {
    paddingBottom: 14,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  locationDropdownHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  locationResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  locationResetBtnText: { color: '#dc2626', fontSize: 10.5, fontFamily: fonts.extrabold },
  locationPillRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  locationPill: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  locationPillActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  locationPillText: { color: '#334155', fontSize: 11.5, fontFamily: fonts.bold },
  promoBannerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#eef2ff', borderWidth: 1, borderColor: '#c7d2fe', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  promoBannerChipIcon: { fontSize: 12 },
  promoBannerChipText: { color: '#3730a3', fontSize: 10.5, fontFamily: fonts.extrabold },
  locationPillTextActive: { color: '#ffffff' },

  /* Latest Classified Deals header styling */
  dealsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  dealsTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: '#0f172a', letterSpacing: -0.3 },
  refreshButton: { padding: 4 },
  sortBar: { flexDirection: 'row', gap: 8, marginBottom: 12, paddingHorizontal: 2 },
  sortPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
  },
  sortText: { color: '#64748b', fontSize: 11.5, fontFamily: fonts.semibold },
  sortValue: { color: '#0f172a', fontFamily: fonts.extrabold },
  sortModalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sortModalCard: { width: '100%', maxWidth: 300, backgroundColor: '#ffffff', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6 },
  sortModalTitle: { fontSize: 13, color: '#0f172a', fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 10, paddingVertical: 8 },
  sortOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  sortOptionText: { color: '#64748b', fontSize: 13.5, fontFamily: fonts.semibold },
  sortOptionTextActive: { color: '#0f172a', fontFamily: fonts.extrabold },

  /* Products standard listing card components */
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  loadingState: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  emptyState: { backgroundColor: '#fff', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginTop: 20 },
  emptyStateTitle: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 15 },
  emptyStateText: { color: '#64748b', marginTop: 4, textAlign: 'center', fontSize: 13 },
  emptyStateRetryBtn: { marginTop: 14, backgroundColor: '#0f172a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, minWidth: 100, alignItems: 'center' },
  emptyStateRetryText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 14, overflow: 'hidden', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: '#e2e8f0' },
  image: { width: '100%', height: 180 },
  cardContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedBadge: { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#bbf7d0' },
  verifiedText: { color: '#166534', fontSize: 10, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5 },
  price: { color: '#0f172a', fontFamily: fonts.extrabold, fontSize: 16, letterSpacing: -0.3 },
  cardTitle: { color: '#1e293b', fontSize: 14, fontFamily: fonts.bold, marginTop: 6 },
  meta: { color: '#64748b', fontSize: 11, marginTop: 3 },
  description: { color: '#475569', marginTop: 7, lineHeight: 18, fontSize: 12.5 },
  footerRow: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seller: { color: '#475569', fontSize: 11.5, fontFamily: fonts.semibold },
  likes: { fontSize: 12, fontFamily: fonts.bold },

  /* IMMERSIVE REELS SIMULATION COMPONENTS */
  videoFeedContainer: { flex: 1, backgroundColor: '#020617' },
  videoFeedList: { flex: 1 },
  videoPlayerFrame: {
    width: '100%',
    backgroundColor: '#000000',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  videoPlaceholderImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoBufferingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPauseOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  videoOverlay: {
    // Lighter than before deliberately — this used to darken a blurred fake
    // placeholder image; with real video playing underneath, a heavy scrim
    // would just dim the actual content for no reason.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.15)',
  },
  videoMuteBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  videoFeedEmptyState: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  videoFeedEmptyEmoji: { fontSize: 44, marginBottom: 14 },
  videoFeedEmptyTitle: { color: '#ffffff', fontSize: 17, fontFamily: fonts.extrabold, marginBottom: 8 },
  videoFeedEmptyText: { color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  videoBottomDetails: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 90,
    zIndex: 10,
  },
  featuredTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  featuredTagText: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: fonts.extrabold,
    letterSpacing: 0.5,
  },
  videoProductTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: fonts.extrabold,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  videoPriceLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  videoProductPrice: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: fonts.extrabold,
  },
  videoLocationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  videoLocationText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontFamily: fonts.bold,
  },
  videoProductDesc: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  videoRightActionsColumn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    alignItems: 'center',
    gap: 12,
    zIndex: 10,
  },
  videoAvatarContainer: {
    position: 'relative',
    marginBottom: 4,
  },
  videoAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  videoAvatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontFamily: fonts.extrabold,
  },
  subscribeBadge: {
    position: 'absolute',
    bottom: -4,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ea580c',
  },
  subscribeBadgeText: {
    color: '#ea580c',
    fontSize: 9,
    fontFamily: fonts.extrabold,
  },
  videoVerifiedBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    alignItems: 'center',
  },
  actionBtnCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  actionBtnCircleActive: {
    backgroundColor: '#f43f5e',
  },
  actionBtnLabel: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: fonts.extrabold,
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 2,
  },
  carouselSection: {
    marginBottom: 18,
  },
  carouselHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  carouselHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  carouselTitle: {
    fontSize: 15,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  forYouSubtitle: {
    fontSize: 11.5,
    fontFamily: fonts.semibold,
    color: '#64748b',
    marginTop: -6,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  carouselViewAllBtn: {
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  carouselViewAllText: {
    color: '#f97316',
    fontSize: 13,
    fontFamily: fonts.extrabold,
  },
  trendingPill: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 4,
  },
  trendingPillText: {
    color: '#e11d48',
    fontSize: 9.5,
    fontFamily: fonts.extrabold,
    letterSpacing: 0.5,
  },
  horizontalCarouselContainer: {
    gap: 12,
    paddingRight: 12,
  },
  featuredDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  featuredDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
  },
  featuredDotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#f97316',
  },
  horizontalCarouselContainerSmall: {
    gap: 10,
    paddingRight: 12,
  },
  carouselCardItem: {
    width: 175,
  },
  carouselCardItemSmall: {
    width: 118,
  },
  loadMoreContainer: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  loadMoreText: {
    color: '#0f172a',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  socialBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 6,
  },
  socialBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 5,
  },
  socialPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  socialBadgeText: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  socialBadgeSub: {
    fontSize: 9.5,
    fontFamily: fonts.semibold,
    color: '#64748b',
  },
  verifiedCountBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  verifiedCountBadgeText: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    color: '#475569',
  },
  sellerDiscoverCard: { width: 220 },
});
