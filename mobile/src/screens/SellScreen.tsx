import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT, useTabBarVisibility } from '../context/TabBarVisibility';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { RefreshCw } from 'lucide-react-native';
// SDK 57 made the bare 'expo-media-library' entrypoint default to a new
// class-based API backed by a native module ('ExpoMediaLibraryNext') that
// this Expo Go build doesn't have registered — crashed the whole app at
// startup with "Cannot find native module 'ExpoMediaLibraryNext'" the
// moment this file's imports were evaluated (SellScreen is imported
// directly by the navigator, so this ran on every app launch, not just
// when the Sell tab was opened). The /legacy entrypoint is the exact same
// function-based API (getPermissionsAsync/getAssetsAsync/getAssetInfoAsync,
// same signatures) this code already used, backed by the older native
// module that's actually available — a drop-in import swap, no other
// changes needed.
import * as MediaLibrary from 'expo-media-library/legacy';
import { categories } from '../data';
import { GHANA_REGIONS } from '../regions';
import { auth, createProduct, updateProduct, uploadMediaToCloudinaryMobile, fetchUserById } from '../firebase';
import { uploadVideoDirectToCloudinaryMobile, getTrimmedVideoUrlMobile, deleteCloudinaryAssetMobile } from '../utils/cloudinary';
import { fonts } from '../theme';
import { EmailVerificationModal, BlockedActionType } from '../components/EmailVerificationModal';
import { BoostModal } from '../components/BoostModal';
import { isUserAdmin } from '../types';

interface SellScreenProps {
  navigation: any;
  route?: any;
}

const MAX_IMAGES = 10;
// The description box's resting height (unfocused, or empty) vs. its height
// the moment it's focused — jumps straight to the roomy size on tap rather
// than only growing gradually as content is typed, so there's already space
// to see everything from the first keystroke. Still grows further past this
// if the actual content needs more.
const DESC_MIN_HEIGHT = 120;
const DESC_FOCUSED_MIN_HEIGHT = 220;
// Native camera recording is capped at the source — a cleaner constraint than
// web's post-hoc "trim after recording" flow, since you simply can't record
// past the limit in the first place. Kept in step with web's 30s trim cap.
const MAX_VIDEO_DURATION_SECONDS = 30;
const MAX_VIDEO_SIZE_BYTES = 18 * 1024 * 1024; // matches web's ListingModal 18MB cap
type CropRatio = 'original' | 'square' | 'portrait';

interface PickedImage {
  id: string;
  localUri: string; // current (possibly cropped) local file used for preview + upload
  originalUri: string; // uncropped source, so switching crop ratios never compounds quality loss
  cropRatio: CropRatio;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  remoteUrl?: string;
  error?: string;
}

interface PickedVideo {
  localUri: string;
  durationSec: number;
  trimStart: number;
  trimEnd: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  remoteUrl?: string;
  error?: string;
}

/** Small self-contained player for previewing a locally-picked/recorded video
 * before it finishes uploading. Isolated in its own component because
 * useVideoPlayer must be called unconditionally per the rules of hooks — this
 * lets the whole preview mount/unmount instead of the hook itself. */
function VideoPreviewThumbnail({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return <VideoView player={player} style={styles.photoThumb} nativeControls={false} contentFit="cover" />;
}

/** Screen 2's video trim step. No client-side re-encoding (see
 * utils/cloudinary.ts getTrimmedVideoUrlMobile for why) — this only lets the
 * seller mark IN/OUT points against real playback, which get baked into the
 * uploaded video's URL as a Cloudinary transform once Continue is tapped.
 * Duration is read from the player itself (authoritative) rather than
 * trusting picker/camera metadata, which isn't always present. */
function VideoTrimEditor({
  uri,
  trimStart,
  trimEnd,
  onDurationReady,
  onSetStart,
  onSetEnd,
}: {
  uri: string;
  trimStart: number;
  trimEnd: number;
  onDurationReady: (seconds: number) => void;
  onSetStart: (seconds: number) => void;
  onSetEnd: (seconds: number) => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const reportedDurationRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const d = player.duration || 0;
      if (d > 0) {
        setDuration(d);
        if (!reportedDurationRef.current) {
          reportedDurationRef.current = true;
          onDurationReady(d);
        }
      }
      setPosition(player.currentTime || 0);
      setIsPlaying(player.playing);
    }, 200);
    return () => clearInterval(interval);
  }, [player]);

  const togglePlay = () => {
    if (player.playing) {
      player.pause();
    } else {
      // Loop playback back to the trim start when replaying, so previewing
      // the selected range doesn't require manually seeking every time.
      if (player.currentTime >= trimEnd - 0.1 || player.currentTime < trimStart) {
        player.currentTime = trimStart;
      }
      player.play();
    }
  };

  const pct = (seconds: number) => (duration > 0 ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0);

  return (
    <View style={{ width: '100%' }}>
      <Pressable onPress={togglePlay} style={styles.trimPlayerWrap}>
        <VideoView player={player} style={styles.trimPlayerVideo} nativeControls={false} contentFit="contain" />
        {!isPlaying && (
          <View style={styles.trimPlayOverlay}>
            <Text style={styles.trimPlayIcon}>▶</Text>
          </View>
        )}
      </Pressable>

      <View style={styles.trimBarTrack}>
        <View style={[styles.trimBarRange, { left: `${pct(trimStart)}%`, width: `${Math.max(2, pct(trimEnd) - pct(trimStart))}%` }]} />
        <View style={[styles.trimBarPlayhead, { left: `${pct(position)}%` }]} />
      </View>
      <View style={styles.trimTimeRow}>
        <Text style={styles.trimTimeText}>{trimStart.toFixed(1)}s</Text>
        <Text style={styles.trimTimeTextMuted}>Selected: {Math.max(0, trimEnd - trimStart).toFixed(1)}s</Text>
        <Text style={styles.trimTimeText}>{trimEnd.toFixed(1)}s</Text>
      </View>

      <View style={styles.trimButtonRow}>
        <Pressable
          onPress={() => onSetStart(Math.min(position, trimEnd - 0.5))}
          style={styles.trimMarkBtn}
        >
          <Text style={styles.trimMarkBtnText}>Set Start Here</Text>
        </Pressable>
        <Pressable
          onPress={() => onSetEnd(Math.max(position, trimStart + 0.5))}
          style={styles.trimMarkBtn}
        >
          <Text style={styles.trimMarkBtnText}>Set End Here</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function SellScreen({ navigation, route }: SellScreenProps) {
  const insets = useSafeAreaInsets();
  // See SearchScreen.tsx for why every tab needs this: the tab bar's
  // hide/show state is one shared value across all tabs, so a screen that
  // never resets it on focus can get stuck showing no tab bar at all.
  const { resetTabBar, hideTabBar } = useTabBarVisibility();
  // Matches web's ListingModal edit mode (productToEdit) — previously
  // entirely absent on mobile: a seller had no way to fix a typo, update a
  // price, or swap photos on an existing ad without deleting and reposting
  // it from scratch. Navigated here via navigation.navigate('Sell', {
  // editProduct }) from ProfileScreen's My Listings "Edit" button. Kept as
  // its own local state (not read directly off route.params) because the
  // Sell tab stays mounted across tab switches — if isEditMode were derived
  // straight from route.params, clearing the param after consuming it would
  // immediately drop the form out of edit mode mid-edit. Consumed once via
  // the effect below, then cleared from params so a later plain tap of the
  // Sell tab icon doesn't silently reopen the same edit session.
  //
  // Edit mode deliberately keeps the ORIGINAL single-form UI unchanged below
  // (see isEditMode branch in the return statement) — the new 3-screen
  // capture → edit → details wizard only applies to creating a brand new
  // listing. Editing isn't "posting new media" in the sense the redesign
  // brief describes, and keeping this path untouched avoids any risk to a
  // flow that was already carefully built and tested this session.
  const [editProduct, setEditProduct] = useState<any>(null);
  const isEditMode = !!editProduct;

  useEffect(() => {
    if (route?.params?.editProduct) {
      setEditProduct(route.params.editProduct);
      navigation.setParams({ editProduct: undefined });
    }
  }, [route?.params?.editProduct]);

  // Tapping the Sell tab icon again while mid-edit is treated as "start a
  // fresh post" — exits edit mode and clears the form back to defaults.
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      setEditProduct((prev: any) => {
        if (!prev) return prev;
        setTitle('');
        setPrice('');
        setDescription('');
        setImages([]);
        setVideo(null);
        setBrand('');
        setCondition('');
        setNegotiable(true);
        setIsExchangeable(false);
        setSelectedCategory('Phones');
        setAdRegion('Greater Accra');
        setAdCity('Accra');
        setAdNeighborhood('');
        setPostFlow('select');
        return null;
      });
    });
    return unsub;
  }, [navigation]);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Phones');
  const [condition, setCondition] = useState('');
  const [brand, setBrand] = useState('');
  const [negotiable, setNegotiable] = useState(true);
  const [isExchangeable, setIsExchangeable] = useState(false);
  // Services category special-case — matches web's ListingModal exactly:
  // price is forced to "Inquire", Brand/Condition/Negotiable/Exchange are
  // replaced by a Service Type picker, and title/brand are both overwritten
  // with the chosen service type at submit time.
  const [serviceSubCategory, setServiceSubCategory] = useState('Photography and Video Services');
  const [customServiceType, setCustomServiceType] = useState('');
  const isServices = selectedCategory === 'Services';
  const SERVICE_TYPES = ['Photography and Video Services', 'Computer or IT Services', 'Fashion Services', 'Other'];
  // Boost-at-creation — matches web's ListingModal "Boost Listing" checkbox
  // (postOption).
  const [postOption, setPostOption] = useState<'normal' | 'boost'>('normal');
  const [boostingProduct, setBoostingProduct] = useState<any>(null);
  // Structured Region/City/Neighborhood — matches web's ListingModal exactly
  // (compiles to the same final `location` string at submit time).
  const [adRegion, setAdRegion] = useState('Greater Accra');
  const [adCity, setAdCity] = useState('Accra');
  const [adNeighborhood, setAdNeighborhood] = useState('');
  const activeRegionObj = GHANA_REGIONS.find((r) => r.name === adRegion);
  useEffect(() => {
    if (activeRegionObj && !activeRegionObj.cities.includes(adCity)) {
      setAdCity(activeRegionObj.cities[0]);
    }
  }, [adRegion]);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);

  // The new 3-screen posting flow for NEW listings — Select media → Preview
  // & edit (crop/trim) → Listing details. Media is picked/captured as
  // LOCAL-ONLY state on Screen 1 (no upload yet — matches the brief's "don't
  // upload prematurely"); the actual Cloudinary upload only starts when
  // Continue is tapped on Screen 2, after any crop/trim has already been
  // applied locally, so each file is uploaded exactly once, already in its
  // final edited form.
  const [postFlow, setPostFlow] = useState<'select' | 'edit' | 'details'>('select');
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);

  // Tab bar hides entirely for the full-bleed camera step, matching the
  // same hide/reset pattern ChatsScreen already uses for an open
  // conversation — Steps 2/3 (light-background forms) and edit mode keep
  // the normal visible bar. Consolidated into one effect (rather than a
  // separate unconditional-reset-on-focus effect) so a 'focus' event
  // arriving after mount can't unconditionally re-show the bar while the
  // camera step is still active.
  const isCameraStepActive = !isEditMode && postFlow === 'select';
  useEffect(() => {
    if (isCameraStepActive) hideTabBar(); else resetTabBar();
    const unsub = navigation?.addListener?.('focus', () => {
      if (isCameraStepActive) hideTabBar(); else resetTabBar();
    });
    return unsub;
  }, [navigation, isCameraStepActive, hideTabBar, resetTabBar]);
  // Always leave it visible again for whichever tab the user lands on next.
  useEffect(() => {
    const unsub = navigation?.addListener?.('blur', resetTabBar);
    return unsub;
  }, [navigation, resetTabBar]);

  const [description, setDescription] = useState('');
  const [descHeight, setDescHeight] = useState(DESC_MIN_HEIGHT);
  // Auto-grows as the user types (onContentSizeChange below) so nothing they
  // type is ever hidden below the visible box — while focused, growth also
  // scrolls the enclosing form down to keep the cursor above the keyboard.
  const [isDescFocused, setIsDescFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  // Synchronous re-entrancy guard for handlePublish — a ref (not state)
  // because state updates aren't visible until the next render, leaving a
  // window where a fast double-tap on Publish could start two overlapping
  // createProduct calls before `loading` ever flips true.
  const isPublishingRef = useRef(false);
  // A single publish *attempt* keeps the same product id across retries, so
  // if the server actually saved the listing but the response/network was
  // lost, retrying reuses the same id — /api/products/sync upserts by id,
  // so this updates the same row instead of creating a duplicate listing.
  // Only cleared on a genuinely new draft (see resetForm below).
  const pendingProductIdRef = useRef<string | null>(null);
  // Shared between edit-mode's single form and the wizard's details step —
  // the two are never mounted at the same time, so one ref is enough. Used
  // to keep the growing description field visible above the keyboard.
  const commonFieldsScrollRef = useRef<ScrollView>(null);
  // Matches web's currentUser.emailVerified gate before posting an ad.
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [blockedActionType, setBlockedActionType] = useState<BlockedActionType>(null);

  // Prefill the form from an existing listing — matches web's ListingModal
  // productToEdit useEffect (back-parses region/city/neighborhood from the
  // compiled location string, and restores the Service Type picker choice).
  useEffect(() => {
    if (!editProduct) return;
    setTitle(editProduct.title || '');
    setDescription(editProduct.description || '');
    let editPrice = String(editProduct.price ?? '');
    if (editPrice.trim().toLowerCase() === 'contact for price') editPrice = 'Inquire';
    setPrice(editPrice === 'Inquire' ? '' : editPrice);
    const cat = editProduct.category || 'Phones';
    setSelectedCategory(cat);
    setBrand(editProduct.brand || '');
    setCondition(editProduct.condition || '');
    setNegotiable(editProduct.negotiable !== false);
    setIsExchangeable(!!(editProduct.isExchangeable || editProduct.exchangePossible));

    if (cat === 'Services') {
      const bd = editProduct.brand || '';
      const standardServices = ['Photography and Video Services', 'Computer or IT Services', 'Fashion Services'];
      if (standardServices.includes(bd)) {
        setServiceSubCategory(bd);
        setCustomServiceType('');
      } else if (bd.trim() !== '') {
        setServiceSubCategory('Other');
        setCustomServiceType(bd);
      }
    }

    const locVal = String(editProduct.location || '');
    let foundRegion = 'Greater Accra';
    let foundCity = 'Accra';
    let foundNeighborhood = '';
    outer: for (const reg of GHANA_REGIONS) {
      if (locVal.toLowerCase().includes(reg.name.toLowerCase())) {
        foundRegion = reg.name;
      }
      for (const city of reg.cities) {
        if (locVal.toLowerCase().includes(city.toLowerCase())) {
          foundCity = city;
          foundRegion = reg.name;
          break outer;
        }
      }
    }
    const parts = locVal.split(',');
    if (parts.length > 1) foundNeighborhood = parts[0].trim();
    setAdRegion(foundRegion);
    setAdCity(foundCity);
    setAdNeighborhood(foundNeighborhood);

    const existingImages: string[] = Array.isArray(editProduct.images) && editProduct.images.length > 0
      ? editProduct.images
      : (editProduct.image ? [editProduct.image] : []);
    setImages(existingImages.map((url: string, idx: number) => ({
      id: `existing_${idx}_${url}`,
      localUri: url,
      originalUri: url,
      cropRatio: 'original' as const,
      status: 'done' as const,
      progress: 100,
      remoteUrl: url,
    })));
    const existingVideos: string[] = Array.isArray(editProduct.videos) ? editProduct.videos : [];
    if (existingVideos.length > 0) {
      setVideo({ localUri: existingVideos[0], durationSec: 0, trimStart: 0, trimEnd: 0, status: 'done', progress: 100, remoteUrl: existingVideos[0] });
    }
  }, [editProduct?.id]);

  useEffect(() => {
    if (auth.currentUser) {
      fetchUserById(auth.currentUser.uid).then((profile) => {
        if (profile) setCurrentUserProfile(profile);
      });
    }
  }, []);

  // Camera state — used by edit-mode's existing "Record Video" button (via
  // the reusable Modal-based camera + openCamera() below, unchanged).
  // `cameraOnCaptureRef` holds whatever the CALLER wants done with the
  // result, kept as a ref rather than state since it's a function value that
  // doesn't need to trigger re-renders.
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraMode, setCameraMode] = useState<'photo' | 'video'>('video');
  const [cameraModeToggleable, setCameraModeToggleable] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraOnCaptureRef = useRef<((kind: 'photo' | 'video', uri: string) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  // Screen 1's own camera-first UI (new listing creation only) — a
  // dedicated inline camera, not the Modal-based one above, since the brief
  // wants the camera to BE Step 1's content the instant the Sell tab opens,
  // not a button the user has to tap first. Kept fully separate from the
  // edit-mode camera state above so neither path can interfere with the
  // other; only one of the two is ever mounted at a time in practice.
  const [wizardCameraFacing, setWizardCameraFacing] = useState<'back' | 'front'>('back');
  const [wizardCameraMode, setWizardCameraMode] = useState<'photo' | 'video'>('photo');
  const [wizardIsRecording, setWizardIsRecording] = useState(false);
  const [wizardIsCapturingPhoto, setWizardIsCapturingPhoto] = useState(false);
  const [wizardRecordingSeconds, setWizardRecordingSeconds] = useState(0);
  const wizardCameraRef = useRef<CameraView>(null);
  const wizardRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wizardRecordingStartedAtRef = useRef<number>(0);

  // Camera permission is requested the instant Step 1 is reached (not on a
  // separate "allow camera access" tap) — matches "open the device camera
  // immediately". `cameraPermission === null` means the OS hasn't been asked
  // yet this app-install; once it's `{granted:false, canAskAgain:false}`
  // (permanently denied) we stop re-prompting and show the Settings path
  // instead, since re-requesting a permanently-denied permission is a no-op
  // on both iOS and Android.
  useEffect(() => {
    if (!isEditMode && postFlow === 'select' && cameraPermission === null) {
      requestCameraPermission();
    }
  }, [isEditMode, postFlow, cameraPermission]);

  // Live "most recent gallery item" thumbnail shown inside the gallery
  // button — a passive, read-only feature layered on top of the existing
  // gallery-picker flow (handleWizardPickFromGallery), not a second
  // permission system. Deliberately uses MediaLibrary.getPermissionsAsync()
  // (a status check, never a prompt) rather than requestPermissionsAsync():
  // the only active permission PROMPT for gallery access anywhere in this
  // screen remains the existing one inside handleWizardPickFromGallery
  // (via expo-image-picker) — this just reflects whatever that already
  // granted, so there's no second/competing "allow gallery access?" dialog.
  const [recentGalleryThumb, setRecentGalleryThumb] = useState<{ uri: string; isVideo: boolean } | null>(null);
  const loadRecentGalleryThumbnail = async () => {
    try {
      // Restricted to photo/video (matches app.json's granularPermissions
      // config) — the unscoped default also checks for an 'audio' grant,
      // which this app never requests/declares, and errors out asking for
      // a permission it isn't set up to have.
      const perm = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
      if (!perm.granted) {
        setRecentGalleryThumb(null);
        return;
      }
      const result = await MediaLibrary.getAssetsAsync({
        first: 1,
        sortBy: [['creationTime', false]],
        mediaType: ['photo', 'video'],
      });
      const asset = result.assets[0];
      if (!asset) {
        setRecentGalleryThumb(null);
        return;
      }
      // On iOS, asset.uri is a ph://<id> Photos-framework reference — not a
      // URL any RN component (e.g. Image) can load directly ("No suitable
      // URL request handler found for ph://..."). Resolving
      // through getAssetInfoAsync() gives a real local file URI instead.
      // Android's asset.uri is already a usable file:// path, but resolving
      // it the same way is harmless and keeps one code path for both.
      let displayUri = asset.uri;
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        if (info.localUri) displayUri = info.localUri;
      } catch (err) {
        console.warn('[loadRecentGalleryThumbnail] getAssetInfoAsync failed, using raw asset.uri:', err);
      }
      if (asset.mediaType === 'video') {
        // expo-video-thumbnails was removed in SDK 56; its replacement
        // (VideoPlayer.generateThumbnailsAsync) returns an expo-image
        // SharedRef rather than a plain uri, which this component's plain
        // <Image> (from react-native, not expo-image) can't consume as-is.
        // Falls back to the existing static-icon path below rather than a
        // rushed rewrite during the SDK 54->57 upgrade — a real video
        // thumbnail preview here is a follow-up, not a regression from
        // before (recent-gallery-thumb still works for photos).
        setRecentGalleryThumb(null);
      } else {
        setRecentGalleryThumb({ uri: displayUri, isVideo: false });
      }
    } catch (err) {
      console.warn('[loadRecentGalleryThumbnail] failed:', err);
      setRecentGalleryThumb(null);
    }
  };

  // Refresh on: Step 1 mount, and every time this screen regains focus
  // (covers "granted permission from OS Settings, then came back" and
  // "took/added a new photo elsewhere, came back" without polling).
  useEffect(() => {
    if (!isEditMode && postFlow === 'select') {
      loadRecentGalleryThumbnail();
    }
  }, [isEditMode, postFlow]);
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      if (!isEditMode && postFlow === 'select') loadRecentGalleryThumbnail();
    });
    return unsub;
  }, [navigation, isEditMode, postFlow]);

  const formCategories = categories.filter((c) => c !== 'All');
  const conditions = ['Brand New', 'Slightly Used', 'Refurbished', 'Used - Fair'];

  const openCamera = async (defaultMode: 'photo' | 'video', toggleable: boolean, onCapture: (kind: 'photo' | 'video', uri: string) => void) => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert(
          'Camera Access Needed',
          'TedBuy needs camera access to take a photo or record a video for your listing. Please enable it in your device Settings.'
        );
        return;
      }
    }
    setCameraMode(defaultMode);
    setCameraModeToggleable(toggleable);
    cameraOnCaptureRef.current = onCapture;
    setShowCameraModal(true);
  };

  const updateImage = (id: string, patch: Partial<PickedImage>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  };

  const uploadPickedImage = async (id: string, localUri: string, base64: string) => {
    updateImage(id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const remoteUrl = await uploadMediaToCloudinaryMobile(
        `data:image/jpeg;base64,${base64}`,
        'image',
        (percent) => updateImage(id, { progress: percent })
      );
      updateImage(id, { status: 'done', progress: 100, remoteUrl });
    } catch (err: any) {
      updateImage(id, { status: 'error', error: err?.message || 'Upload failed' });
    }
  };

  // Edit-mode's existing "Add Photo" button — unchanged behavior (uploads
  // immediately on pick, matching how edit mode has always worked).
  const handlePickImages = async () => {
    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', `You can only upload up to ${MAX_IMAGES} images per listing.`);
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo Access Needed',
        permission.canAskAgain === false
          ? 'TedBuy needs access to your photos to add pictures to your listing. You previously denied this — enable it in your device Settings to continue.'
          : 'TedBuy needs access to your photos to add pictures to your listing.',
        permission.canAskAgain === false
          ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }]
          : undefined
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    for (const asset of result.assets) {
      const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        setImages((prev) => [
          ...prev,
          { id, localUri: manipulated.uri, originalUri: manipulated.uri, cropRatio: 'original', status: 'uploading', progress: 0 },
        ]);
        if (manipulated.base64) {
          uploadPickedImage(id, manipulated.uri, manipulated.base64);
        } else {
          updateImage(id, { status: 'error', error: 'Could not process image' });
        }
      } catch (err: any) {
        Alert.alert('Image Error', `Could not process one of the selected photos: ${err?.message || 'Unknown error'}`);
      }
    }
  };

  const handleRemoveImage = (id: string) => {
    const target = images.find((i) => i.id === id);
    setImages((prev) => prev.filter((img) => img.id !== id));
    if (target?.status === 'done' && target.remoteUrl) {
      deleteCloudinaryAssetMobile(target.remoteUrl);
    }
  };

  const handleRetryImage = (id: string) => {
    const img = images.find((i) => i.id === id);
    if (!img) return;
    ImageManipulator.manipulateAsync(img.localUri, [], { base64: true, compress: 1 })
      .then((res) => {
        if (res.base64) uploadPickedImage(id, img.localUri, res.base64);
        else updateImage(id, { status: 'error', error: 'Could not re-read image for retry' });
      })
      .catch(() => updateImage(id, { status: 'error', error: 'Could not re-read image for retry' }));
  };

  const handleSetCover = (id: string) => {
    setImages((prev) => {
      const idx = prev.findIndex((img) => img.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.unshift(item);
      return next;
    });
  };

  const uploadPickedVideo = async (localUri: string, durationSec: number, trimStart: number, trimEnd: number) => {
    setVideo({ localUri, durationSec, trimStart, trimEnd, status: 'uploading', progress: 0 });
    try {
      const result = await uploadVideoDirectToCloudinaryMobile(localUri, (percent) => {
        setVideo((prev) => (prev ? { ...prev, progress: percent } : prev));
      });
      // Bake the chosen trim range into the stored URL now (see
      // getTrimmedVideoUrlMobile) — the raw upload always happens exactly
      // once regardless of trim; only which URL gets saved differs.
      const finalDuration = durationSec || result.duration || (trimEnd - trimStart);
      const trimmedUrl = getTrimmedVideoUrlMobile(result.secure_url, trimStart, trimEnd, finalDuration);
      setVideo({ localUri, durationSec: finalDuration, trimStart, trimEnd, status: 'done', progress: 100, remoteUrl: trimmedUrl });
    } catch (err: any) {
      setVideo({ localUri, durationSec, trimStart, trimEnd, status: 'error', progress: 0, error: err?.message || 'Video upload failed' });
    }
  };

  const handleRemoveVideo = () => {
    if (video?.status === 'done' && video.remoteUrl) {
      deleteCloudinaryAssetMobile(video.remoteUrl);
    }
    setVideo(null);
  };

  const handleRetryVideo = () => {
    if (video) uploadPickedVideo(video.localUri, video.durationSec, video.trimStart, video.trimEnd);
  };

  // Edit-mode's existing "Choose from Library" video button — unchanged
  // (uploads immediately, relies on the OS's own trim editor via
  // allowsEditing since edit mode doesn't get the new in-app trim screen).
  const handlePickVideoFromLibrary = async () => {
    if (video) {
      Alert.alert('Video Already Added', 'Remove the current video first to pick a different one.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo Access Needed',
        permission.canAskAgain === false
          ? 'TedBuy needs access to your photo library to add a video to your listing. You previously denied this — enable it in your device Settings to continue.'
          : 'TedBuy needs access to your photo library to add a video to your listing.',
        permission.canAskAgain === false
          ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }]
          : undefined
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: true,
      videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0];
    if (asset.duration && asset.duration / 1000 > MAX_VIDEO_DURATION_SECONDS + 1) {
      Alert.alert(
        'Video Too Long',
        `This video is still over ${MAX_VIDEO_DURATION_SECONDS} seconds after editing. Please trim it shorter, or use "Record Video" which stops automatically at the limit.`
      );
      return;
    }
    if ((asset as any).fileSize && (asset as any).fileSize > MAX_VIDEO_SIZE_BYTES) {
      Alert.alert(
        'Video Too Large',
        `Please choose a video under ${Math.round(MAX_VIDEO_SIZE_BYTES / (1024 * 1024))}MB. Try trimming it shorter or lowering its quality first.`
      );
      return;
    }

    const durationSec = asset.duration ? asset.duration / 1000 : MAX_VIDEO_DURATION_SECONDS;
    uploadPickedVideo(asset.uri, durationSec, 0, durationSec);
  };

  const handleStartRecording = async () => {
    if (!cameraRef.current || isRecording) return;
    setIsRecording(true);
    setRecordingSeconds(0);

    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((prev) => {
        if (prev + 1 >= MAX_VIDEO_DURATION_SECONDS) {
          handleStopRecording();
        }
        return prev + 1;
      });
    }, 1000);

    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_SECONDS });
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      setShowCameraModal(false);
      if (result?.uri) {
        cameraOnCaptureRef.current?.('video', result.uri);
      }
    } catch (err: any) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      Alert.alert('Recording Error', err?.message || 'Could not record video.');
    }
  };

  const handleStopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    cameraRef.current?.stopRecording();
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || isCapturingPhoto) return;
    setIsCapturingPhoto(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      setShowCameraModal(false);
      if (photo?.uri) {
        cameraOnCaptureRef.current?.('photo', photo.uri);
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err?.message || 'Could not take photo.');
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  // ---- New wizard: Screen 1 (Select/Capture Media) --------------------
  // Adds a photo/video to LOCAL-ONLY state — no upload yet. The actual
  // Cloudinary upload is deferred to handleContinueToDetails() below, after
  // any crop/trim on Screen 2 has already been applied.
  const addPendingImage = async (sourceUri: string) => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert('Limit Reached', `You can only add up to ${MAX_IMAGES} photos per listing.`);
      return;
    }
    const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    try {
      const manipulated = await ImageManipulator.manipulateAsync(sourceUri, [{ resize: { width: 1600 } }], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setImages((prev) => [
        ...prev,
        { id, localUri: manipulated.uri, originalUri: manipulated.uri, cropRatio: 'original', status: 'pending', progress: 0 },
      ]);
    } catch (err: any) {
      Alert.alert('Image Error', err?.message || 'Could not process the selected photo.');
    }
  };

  const addPendingVideo = async (sourceUri: string, durationMs?: number) => {
    if (video) {
      Alert.alert('Video Already Added', 'Remove the current video first to add a different one.');
      return;
    }
    const durationSec = durationMs ? durationMs / 1000 : MAX_VIDEO_DURATION_SECONDS;
    setVideo({ localUri: sourceUri, durationSec, trimStart: 0, trimEnd: durationSec, status: 'pending', progress: 0 });
  };

  const handleWizardPickFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo Access Needed',
        permission.canAskAgain === false
          ? 'TedBuy needs access to your photos and videos to add media to your listing. You previously denied this — enable it in your device Settings to continue.'
          : 'TedBuy needs access to your photos and videos to add media to your listing.',
        permission.canAskAgain === false
          ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }]
          : undefined
      );
      return;
    }
    // Permission may have just been granted for the first time here — refresh
    // the gallery-button thumbnail so it doesn't wait for the next screen
    // focus to pick that up. Fire-and-forget: this must never block/delay
    // opening the actual picker below.
    loadRecentGalleryThumbnail();

    const remainingSlots = MAX_IMAGES - images.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: video ? ['images'] : ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, remainingSlots),
      videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
      quality: 1,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    let videoAlreadyTaken = !!video;
    for (const asset of result.assets) {
      if (asset.type === 'video') {
        if (videoAlreadyTaken) {
          Alert.alert('One Video Only', 'Only the first video you selected was added — a listing can have just 1 video.');
          continue;
        }
        if (asset.duration && asset.duration / 1000 > MAX_VIDEO_DURATION_SECONDS + 1) {
          Alert.alert('Video Too Long', `Please choose a video under ${MAX_VIDEO_DURATION_SECONDS} seconds.`);
          continue;
        }
        if ((asset as any).fileSize && (asset as any).fileSize > MAX_VIDEO_SIZE_BYTES) {
          Alert.alert('Video Too Large', `Please choose a video under ${Math.round(MAX_VIDEO_SIZE_BYTES / (1024 * 1024))}MB.`);
          continue;
        }
        videoAlreadyTaken = true;
        await addPendingVideo(asset.uri, asset.duration || undefined);
      } else {
        await addPendingImage(asset.uri);
      }
    }
    setPostFlow('edit');
  };

  // Screen 1's inline camera capture — the camera view itself IS Screen 1
  // (see the render section below), so these just take/record and hand the
  // result straight to Screen 2, no intermediate "Camera vs Gallery" choice
  // screen and no Modal to open first.
  const handleWizardTakePhoto = async () => {
    if (!wizardCameraRef.current || wizardIsCapturingPhoto) return;
    setWizardIsCapturingPhoto(true);
    try {
      const photo = await wizardCameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        await addPendingImage(photo.uri);
        setPostFlow('edit');
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err?.message || 'Could not take photo.');
    } finally {
      setWizardIsCapturingPhoto(false);
    }
  };

  const handleWizardStartRecording = async () => {
    if (!wizardCameraRef.current || wizardIsRecording) return;
    if (video) {
      Alert.alert('Video Already Added', 'Remove the current video on the next screen before recording a new one.');
      return;
    }
    if (!micPermission?.granted) {
      const res = await requestMicPermission();
      if (!res.granted) {
        Alert.alert(
          'Microphone Access Needed',
          res.canAskAgain === false
            ? 'TedBuy needs microphone access to record sound with your listing video. Please enable it in your device Settings.'
            : 'TedBuy needs microphone access to record sound with your listing video.',
          res.canAskAgain === false ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel', style: 'cancel' }] : undefined
        );
        return;
      }
    }

    setWizardIsRecording(true);
    setWizardRecordingSeconds(0);
    wizardRecordingStartedAtRef.current = Date.now();
    wizardRecordingTimerRef.current = setInterval(() => {
      setWizardRecordingSeconds((prev) => {
        if (prev + 1 >= MAX_VIDEO_DURATION_SECONDS) {
          handleWizardStopRecording();
        }
        return prev + 1;
      });
    }, 1000);

    try {
      const result = await wizardCameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_SECONDS });
      if (wizardRecordingTimerRef.current) {
        clearInterval(wizardRecordingTimerRef.current);
        wizardRecordingTimerRef.current = null;
      }
      setWizardIsRecording(false);
      if (result?.uri) {
        // Timestamp-based, not the interval-driven state — avoids a stale
        // closure over wizardRecordingSeconds from the moment recording
        // started, since this handler's own closure never sees later
        // re-renders' updated state.
        const elapsedMs = Date.now() - wizardRecordingStartedAtRef.current;
        await addPendingVideo(result.uri, elapsedMs > 0 ? elapsedMs : undefined);
        setPostFlow('edit');
      }
    } catch (err: any) {
      if (wizardRecordingTimerRef.current) {
        clearInterval(wizardRecordingTimerRef.current);
        wizardRecordingTimerRef.current = null;
      }
      setWizardIsRecording(false);
      Alert.alert('Recording Error', err?.message || 'Could not record video.');
    }
  };

  const handleWizardStopRecording = () => {
    if (wizardRecordingTimerRef.current) {
      clearInterval(wizardRecordingTimerRef.current);
      wizardRecordingTimerRef.current = null;
    }
    wizardCameraRef.current?.stopRecording();
  };

  // ---- New wizard: Screen 2 (Preview & Edit) ---------------------------
  const applyCropRatio = async (imageId: string, ratio: CropRatio) => {
    const img = images.find((i) => i.id === imageId);
    if (!img) return;
    try {
      if (ratio === 'original') {
        updateImage(imageId, { localUri: img.originalUri, cropRatio: 'original' });
        return;
      }
      const info = await ImageManipulator.manipulateAsync(img.originalUri, []);
      const { width, height } = info;
      let cropWidth = width;
      let cropHeight = height;
      if (ratio === 'square') {
        const side = Math.min(width, height);
        cropWidth = side;
        cropHeight = side;
      } else if (ratio === 'portrait') {
        // 4:5 — the standard marketplace/social listing photo ratio.
        const targetRatio = 4 / 5;
        if (width / height > targetRatio) {
          cropHeight = height;
          cropWidth = Math.round(height * targetRatio);
        } else {
          cropWidth = width;
          cropHeight = Math.round(width / targetRatio);
        }
      }
      const originX = Math.round((width - cropWidth) / 2);
      const originY = Math.round((height - cropHeight) / 2);
      const cropped = await ImageManipulator.manipulateAsync(
        img.originalUri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      updateImage(imageId, { localUri: cropped.uri, cropRatio: ratio });
    } catch (err: any) {
      Alert.alert('Crop Error', err?.message || 'Could not crop this photo.');
    }
  };

  const handleVideoDurationReady = (seconds: number) => {
    setVideo((prev) => {
      if (!prev) return prev;
      // Only widen trimEnd to the real duration if it was still at its
      // placeholder default — never clobber a range the user already set.
      if (prev.trimEnd > 0 && prev.trimEnd < seconds - 0.05) return { ...prev, durationSec: seconds };
      return { ...prev, durationSec: seconds, trimEnd: seconds };
    });
  };

  // Cloudinary upload starts here — after Screen 2's edits are applied,
  // before the user even reaches the details form. Runs in the background;
  // Screen 3's Post button stays disabled until every item finishes, same
  // guard pattern the form already used.
  const handleContinueToDetails = () => {
    images.forEach((img) => {
      if (img.status === 'pending') {
        // Was missing a .catch — a rejection here (corrupt/unreadable file)
        // used to leave the image stuck at 'pending' forever, silently
        // blocking Publish with no visible error or retry option.
        ImageManipulator.manipulateAsync(img.localUri, [], { base64: true, compress: 1 }).then((res) => {
          if (res.base64) return uploadPickedImage(img.id, img.localUri, res.base64);
          updateImage(img.id, { status: 'error', error: 'Could not read this photo. Please remove it and try again.' });
        }).catch(() => {
          updateImage(img.id, { status: 'error', error: 'Could not process this photo. Please remove it and try again.' });
        });
      }
    });
    if (video && video.status === 'pending') {
      uploadPickedVideo(video.localUri, video.durationSec, video.trimStart, video.trimEnd);
    }
    setPostFlow('details');
  };

  const handleBackToSelect = () => {
    setPostFlow('select');
  };

  const handleDiscard = () => {
    Alert.alert(
      'Discard This Listing?',
      'This will remove everything you’ve added so far, including any uploaded photos or video. This can’t be undone.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // Was missing here (only cleared in resetForm() on the success
            // path) — without this, a failed publish whose response was lost
            // but which actually succeeded server-side, followed by Discard
            // and then a brand-new, different listing, would silently reuse
            // the same id and overwrite the earlier (unknown-to-the-client)
            // listing instead of the two existing independently.
            pendingProductIdRef.current = null;
            images.forEach((img) => {
              if (img.status === 'done' && img.remoteUrl) deleteCloudinaryAssetMobile(img.remoteUrl);
            });
            if (video?.status === 'done' && video.remoteUrl) deleteCloudinaryAssetMobile(video.remoteUrl);
            setTitle('');
            setPrice('');
            setDescription('');
            setImages([]);
            setVideo(null);
            setBrand('');
            setCondition('');
            setNegotiable(true);
            setIsExchangeable(false);
            setPostOption('normal');
            setPostFlow('select');
          },
        },
      ]
    );
  };

  const handlePublish = async () => {
    // Synchronous — closes the double-tap race window entirely, unlike
    // relying on the Pressable's `disabled` prop (which only takes effect
    // after a re-render).
    if (isPublishingRef.current) return;

    if (!auth.currentUser) {
      Alert.alert('Authentication Required', 'Please sign in or create an account from the Profile tab to publish listings.', [
        { text: 'Go to Profile', onPress: () => navigation.navigate('Profile') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    if (!currentUserProfile?.emailVerified) {
      setBlockedActionType('post-ad');
      return;
    }

    if (selectedCategory === 'Jobs & Employment') {
      if (!title.trim() || !description.trim()) {
        Alert.alert('Missing Fields', 'Please fill in the job title and detailed description.');
        return;
      }
    } else if (isServices) {
      if (!description.trim()) {
        Alert.alert('Missing Fields', 'Please fill in the detailed description.');
        return;
      }
    } else {
      if (!title.trim() || !price.trim() || !description.trim()) {
        Alert.alert('Missing Fields', 'Please fill in the listing title, price, and description.');
        return;
      }
    }

    if (isServices && serviceSubCategory === 'Other' && !customServiceType.trim()) {
      Alert.alert('Missing Fields', 'Please write your service category type since you selected "Other".');
      return;
    }
    if (title.trim().length > 150) {
      Alert.alert('Title Too Long', 'Please keep the title under 150 characters.');
      return;
    }
    if (description.trim().length > 5000) {
      Alert.alert('Description Too Long', 'Please keep the description under 5000 characters.');
      return;
    }

    if (selectedCategory !== 'Jobs & Employment' && images.length === 0 && !video) {
      Alert.alert('Missing Media', 'Please upload at least 1 photo or 1 video for this listing.');
      return;
    }

    if (images.some((img) => img.status === 'uploading' || img.status === 'pending')) {
      Alert.alert('Please Wait', 'Some photos are still uploading. Please wait for them to finish.');
      return;
    }
    if (images.some((img) => img.status === 'error')) {
      Alert.alert('Photo Upload Failed', 'One or more photos failed to upload. Remove them or retry before publishing.');
      return;
    }
    if (video?.status === 'uploading' || video?.status === 'pending') {
      Alert.alert('Please Wait', 'Your video is still uploading. Please wait for it to finish.');
      return;
    }
    if (video?.status === 'error') {
      Alert.alert('Video Upload Failed', 'Your video failed to upload. Remove it or retry before publishing.');
      return;
    }

    setLoading(true);
    isPublishingRef.current = true;
    try {
      let formattedPrice: string | number = 'Inquire';
      if (selectedCategory !== 'Jobs & Employment' && !isServices) {
        const rawPrice = price.trim();
        const stripCommas = rawPrice.replace(/,/g, '');
        formattedPrice = (!isNaN(Number(stripCommas)) && stripCommas !== '') ? Number(stripCommas) : rawPrice;
      }

      const uploadedImageUrls = images.map((img) => img.remoteUrl!).filter(Boolean);
      const uploadedVideoUrl = video?.status === 'done' ? video.remoteUrl : undefined;
      const defaultImage = selectedCategory === 'Jobs & Employment'
        ? 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80'
        : 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80';
      const finalImages = uploadedImageUrls.length > 0
        ? uploadedImageUrls
        : (uploadedVideoUrl ? [] : [defaultImage]);
      // Reuse the same id across retries of this same draft — /api/products/sync
      // upserts by id, so if the server actually saved a previous attempt but
      // the response was lost (network drop), retrying updates that same row
      // instead of creating a second, duplicate listing.
      if (!pendingProductIdRef.current) {
        pendingProductIdRef.current = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      }
      const prodId = pendingProductIdRef.current;
      const compiledLocation = adNeighborhood.trim() ? `${adNeighborhood.trim()}, ${adCity}` : adCity;

      const serviceLabel = serviceSubCategory === 'Other' ? (customServiceType.trim() || 'Other Service') : serviceSubCategory;
      const finalTitle = isServices ? serviceLabel : title.trim();
      const finalBrand = isServices ? serviceLabel : (selectedCategory === 'Jobs & Employment' ? '' : brand.trim());
      const finalCondition = isServices ? 'Service Offered' : (selectedCategory === 'Jobs & Employment' ? 'Job Opening' : condition);
      const finalNegotiable = (isServices || selectedCategory === 'Jobs & Employment') ? false : negotiable;
      const finalIsExchangeable = (isServices || selectedCategory === 'Jobs & Employment') ? false : isExchangeable;

      if (isEditMode) {
        await updateProduct(editProduct.id, {
          title: finalTitle,
          description: description.trim(),
          price: formattedPrice,
          category: selectedCategory,
          location: compiledLocation,
          brand: finalBrand,
          condition: finalCondition,
          images: finalImages,
          image: finalImages[0] || '',
          videos: uploadedVideoUrl ? [uploadedVideoUrl] : [],
          negotiable: finalNegotiable,
          isExchangeable: finalIsExchangeable,
          exchangePossible: finalIsExchangeable,
        });
        setLoading(false);
        const editedProductId = editProduct.id;
        setEditProduct(null);
        Alert.alert('Ad Updated', 'Your listing was updated successfully!', [
          {
            text: 'OK',
            onPress: () => navigation.navigate('ProductDetail', { productId: editedProductId }),
          },
        ]);
        return;
      }

      const productData = {
        id: prodId,
        title: finalTitle,
        price: formattedPrice,
        category: selectedCategory,
        condition: finalCondition,
        brand: finalBrand,
        negotiable: finalNegotiable,
        isExchangeable: finalIsExchangeable,
        exchangePossible: finalIsExchangeable,
        location: compiledLocation,
        description: description.trim(),
        image: finalImages[0] || '',
        images: finalImages,
        videos: uploadedVideoUrl ? [uploadedVideoUrl] : [],
        sellerId: auth.currentUser.uid,
        sellerName: auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || 'Verified Seller',
        sellerPhoto: auth.currentUser.photoURL || '',
        sellerJoinDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        createdAt: new Date().toISOString(),
        viewsCount: 0,
        likesCount: 0,
      };

      const created = await createProduct(productData);
      setLoading(false);

      const resetForm = () => {
        // This draft is done (published) — a later publish should mint a
        // fresh id, not silently overwrite this listing.
        pendingProductIdRef.current = null;
        setTitle('');
        setPrice('');
        setDescription('');
        setImages([]);
        setVideo(null);
        setIsExchangeable(false);
        setPostOption('normal');
        setPostFlow('select');
      };

      if (postOption === 'boost') {
        resetForm();
        setBoostingProduct(created);
        return;
      }

      Alert.alert('Success', 'Your listing was successfully published on TedBuy Ghana!', [
        {
          text: 'View Feed',
          onPress: () => {
            resetForm();
            navigation.navigate('Home');
          },
        },
      ]);
    } catch (error: any) {
      setLoading(false);
      Alert.alert(isEditMode ? 'Update Error' : 'Publish Error', error.message || 'Something went wrong.');
    } finally {
      // Always release the guard — including on success, since resetForm()
      // (or the edit-mode success path) has already cleared/consumed the
      // draft id above, so a subsequent tap is either disabled (post-success
      // navigation is imminent) or genuinely starting a fresh draft.
      isPublishingRef.current = false;
    }
  };

  // Shared listing-detail fields (category through description) — used by
  // both edit mode's classic single-form view and the new wizard's Screen 3,
  // so the two never drift out of sync with each other.
  const renderCommonFields = (scrollRef?: React.RefObject<ScrollView | null>) => (
    <>
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {formCategories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <Pressable key={cat} onPress={() => setSelectedCategory(cat)} style={[styles.chip, isSelected && styles.chipActive]}>
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{cat}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>{selectedCategory === 'Jobs & Employment' ? 'Job Title' : 'Listing Title'}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={selectedCategory === 'Jobs & Employment' ? 'e.g. Graphic Designer, Store Manager, Sales Executive' : 'e.g. iPhone 15 Pro Max 256GB'}
          style={styles.input}
          placeholderTextColor="#94a3b8"
          maxLength={150}
        />
      </View>

      {isServices && (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Service Type</Text>
          <View style={styles.chipRow}>
            {SERVICE_TYPES.map((svc) => {
              const isSelected = serviceSubCategory === svc;
              return (
                <Pressable key={svc} onPress={() => setServiceSubCategory(svc)} style={[styles.chip, isSelected && styles.chipActive]}>
                  <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{svc}</Text>
                </Pressable>
              );
            })}
          </View>
          {serviceSubCategory === 'Other' && (
            <TextInput
              value={customServiceType}
              onChangeText={setCustomServiceType}
              placeholder="e.g. Catering, Plumbing, Cleaning"
              style={[styles.input, { marginTop: 10 }]}
              placeholderTextColor="#94a3b8"
            />
          )}
        </View>
      )}

      {selectedCategory !== 'Jobs & Employment' && !isServices && (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Price (GHS)</Text>
          <View style={styles.priceInputWrapper}>
            <Text style={styles.pricePrefix}>GH₵</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="e.g. 9500"
              keyboardType="numeric"
              style={[styles.input, { flex: 1, borderWidth: 0, paddingLeft: 6, height: 44 }]}
              placeholderTextColor="#94a3b8"
            />
          </View>
          <Pressable onPress={() => setNegotiable((prev) => !prev)} style={styles.negotiableRow}>
            <View style={[styles.negotiableCheckbox, negotiable && styles.negotiableCheckboxChecked]}>
              {negotiable && <Text style={styles.negotiableCheckMark}>✓</Text>}
            </View>
            <Text style={styles.negotiableRowText}>Price is negotiable</Text>
          </Pressable>
        </View>
      )}

      {selectedCategory !== 'Jobs & Employment' && !isServices && (
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Brand / Manufacturer (Optional)</Text>
          <TextInput
            value={brand}
            onChangeText={setBrand}
            placeholder="e.g. Apple, Nike, Samsung, Toyota"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
        </View>
      )}

      {selectedCategory !== 'Jobs & Employment' && !isServices && (
        <View style={styles.inputGroup}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.label}>Item Condition (Optional)</Text>
            {!!condition && (
              <Pressable onPress={() => setCondition('')}>
                <Text style={styles.conditionClearText}>Clear</Text>
              </Pressable>
            )}
          </View>
          <TextInput
            value={condition}
            onChangeText={setCondition}
            placeholder="e.g. Brand New, Slightly Used (optional)"
            style={[styles.input, { marginBottom: 8 }]}
            placeholderTextColor="#94a3b8"
          />
          <View style={styles.chipRow}>
            {conditions.map((cond) => {
              const isSelected = condition === cond;
              return (
                <Pressable key={cond} onPress={() => setCondition(isSelected ? '' : cond)} style={[styles.chip, isSelected && styles.chipActive]}>
                  <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{cond}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {selectedCategory !== 'Jobs & Employment' && !isServices && (
        <View style={styles.toggleRowContainer}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.toggleTitle}>Exchange / Swap Possible</Text>
            <Text style={styles.toggleSubtitle}>Indicate if you accept item trade or exchange</Text>
          </View>
          <Switch
            value={isExchangeable}
            onValueChange={setIsExchangeable}
            trackColor={{ false: '#e2e8f0', true: '#10b981' }}
            thumbColor={isExchangeable ? '#ffffff' : '#f8fafc'}
          />
        </View>
      )}

      <View style={styles.inputGroup}>
        <Text style={styles.label}>{selectedCategory === 'Jobs & Employment' ? 'Location (Region in Ghana)' : 'Region in Ghana'}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationPillRow}>
          {GHANA_REGIONS.map((reg) => {
            const isSelected = adRegion === reg.name;
            return (
              <Pressable key={reg.name} onPress={() => setAdRegion(reg.name)} style={[styles.chip, isSelected && styles.chipActive]}>
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{reg.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>City / Town</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationPillRow}>
          {activeRegionObj?.cities.map((city) => {
            const isSelected = adCity === city;
            return (
              <Pressable key={city} onPress={() => setAdCity(city)} style={[styles.chip, isSelected && styles.chipActive]}>
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{city}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>
          {selectedCategory === 'Jobs & Employment' ? 'Specific Office Area / Work Location (Optional)' : 'Neighborhood (Optional)'}
        </Text>
        <TextInput
          value={adNeighborhood}
          onChangeText={setAdNeighborhood}
          placeholder={selectedCategory === 'Jobs & Employment' ? 'e.g. Airport Residential Area, Remote' : 'e.g. East Legon, Spintex Road'}
          style={styles.input}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>
          {selectedCategory === 'Jobs & Employment' ? 'Detailed Job Description & Requirements' : 'Detailed Description'}
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          onFocus={() => {
            setIsDescFocused(true);
            // Jump to the full focused height immediately, don't wait for
            // content to grow into it — the whole point is that there's
            // already room to see everything as they type, from the first
            // keystroke.
            requestAnimationFrame(() => scrollRef?.current?.scrollToEnd({ animated: true }));
          }}
          onBlur={() => setIsDescFocused(false)}
          onContentSizeChange={(e) => {
            const nextH = Math.max(DESC_FOCUSED_MIN_HEIGHT, e.nativeEvent.contentSize.height);
            if (isDescFocused && nextH > descHeight && scrollRef?.current) {
              requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
            }
            setDescHeight(nextH);
          }}
          placeholder={selectedCategory === 'Jobs & Employment' ? 'Describe job responsibilities, candidate requirements, work schedule, compensation, and how to apply...' : 'Describe your item condition, specifications, and if price is negotiable...'}
          style={[styles.input, styles.textArea, { height: Math.max(isDescFocused ? DESC_FOCUSED_MIN_HEIGHT : DESC_MIN_HEIGHT, descHeight) }]}
          multiline
          numberOfLines={4}
          scrollEnabled={false}
          placeholderTextColor="#94a3b8"
          textAlignVertical="top"
          maxLength={5000}
        />
      </View>
    </>
  );

  const anyMediaBusy = images.some((img) => img.status === 'uploading' || img.status === 'pending') || video?.status === 'uploading' || video?.status === 'pending';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {!auth.currentUser ? (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>Post an Ad</Text>
            <Text style={styles.subtitle}>Sell your items to thousands of buyers in Ghana</Text>
          </View>
          <ScrollView contentContainerStyle={[styles.contentContainer, { paddingBottom: 32 + TAB_BAR_HEIGHT + insets.bottom }]}>
            <View style={styles.authLockCard}>
              <Text style={styles.lockEmoji}>🔒</Text>
              <Text style={styles.lockTitle}>Authentication Required</Text>
              <Text style={styles.lockText}>
                You must be logged in to your TedBuy account to create listings. Connect with buyers directly and track your ads.
              </Text>
              <Pressable onPress={() => navigation.navigate('Profile')} style={styles.authButton}>
                <Text style={styles.authButtonText}>SIGN IN / SIGN UP</Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      ) : isEditMode ? (
        <>
          {/* Edit mode — the original single-form UI, completely unchanged. */}
          <View style={styles.header}>
            <Text style={styles.title}>Edit Listing</Text>
            <Text style={styles.subtitle}>Update your listing details below</Text>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView
              ref={commonFieldsScrollRef}
              style={styles.container}
              contentContainerStyle={[styles.contentContainer, { paddingBottom: 32 + TAB_BAR_HEIGHT + insets.bottom }]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.formCard}>
                <Text style={styles.formSectionTitle}>
                  {selectedCategory === 'Jobs & Employment' ? 'JOB VACANCY DETAILS' : 'LISTING SPECIFICATIONS'}
                </Text>

                {renderCommonFields(commonFieldsScrollRef)}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>
                    {selectedCategory === 'Jobs & Employment' ? 'Company Logo / Job Flyer Photos (Optional)' : `Product Photos${video ? ' (Optional)' : ' (Required — or add a video below)'}`}
                  </Text>
                  <Text style={styles.photoHint}>
                    The first photo is your cover image. Tap any other photo to make it the cover. Up to {MAX_IMAGES} photos.
                  </Text>
                  <View style={styles.photoGrid}>
                    {images.map((img, idx) => (
                      <Pressable key={img.id} onPress={() => img.status === 'done' && idx !== 0 && handleSetCover(img.id)} style={styles.photoThumbWrapper}>
                        <Image source={{ uri: img.localUri }} style={styles.photoThumb} />
                        {idx === 0 && (
                          <View style={styles.coverBadge}>
                            <Text style={styles.coverBadgeText}>COVER</Text>
                          </View>
                        )}
                        {img.status === 'uploading' && (
                          <View style={styles.photoOverlay}>
                            <ActivityIndicator size="small" color="#ffffff" />
                            <Text style={styles.photoOverlayText}>{img.progress}%</Text>
                          </View>
                        )}
                        {img.status === 'error' && (
                          <View style={[styles.photoOverlay, styles.photoOverlayError]}>
                            <Text style={styles.photoOverlayText}>Failed</Text>
                            <Pressable onPress={() => handleRetryImage(img.id)} style={styles.retryBtn}>
                              <Text style={styles.retryBtnText}>Retry</Text>
                            </Pressable>
                          </View>
                        )}
                        <Pressable onPress={() => handleRemoveImage(img.id)} style={styles.removePhotoBtn} hitSlop={6}>
                          <Text style={styles.removePhotoBtnText}>✕</Text>
                        </Pressable>
                      </Pressable>
                    ))}
                    {images.length < MAX_IMAGES && (
                      <Pressable onPress={handlePickImages} style={styles.addPhotoBtn}>
                        <Text style={styles.addPhotoBtnIcon}>+</Text>
                        <Text style={styles.addPhotoBtnText}>Add Photo</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Product Video (Optional, Max 1)</Text>
                  <Text style={styles.photoHint}>
                    Record a quick video demo right in the app, or choose one from your library. Max {MAX_VIDEO_DURATION_SECONDS} seconds.
                  </Text>
                  {video ? (
                    <View style={styles.photoGrid}>
                      <View style={styles.photoThumbWrapper}>
                        <VideoPreviewThumbnail uri={video.localUri} />
                        {video.status === 'uploading' && (
                          <View style={styles.photoOverlay}>
                            <ActivityIndicator size="small" color="#ffffff" />
                            <Text style={styles.photoOverlayText}>{video.progress}%</Text>
                          </View>
                        )}
                        {video.status === 'error' && (
                          <View style={[styles.photoOverlay, styles.photoOverlayError]}>
                            <Text style={styles.photoOverlayText}>Failed</Text>
                            <Pressable onPress={handleRetryVideo} style={styles.retryBtn}>
                              <Text style={styles.retryBtnText}>Retry</Text>
                            </Pressable>
                          </View>
                        )}
                        <Pressable onPress={handleRemoveVideo} style={styles.removePhotoBtn} hitSlop={6}>
                          <Text style={styles.removePhotoBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.videoActionRow}>
                      <Pressable
                        onPress={() => openCamera('video', false, (kind, uri) => { if (kind === 'video') uploadPickedVideo(uri, MAX_VIDEO_DURATION_SECONDS, 0, MAX_VIDEO_DURATION_SECONDS); })}
                        style={styles.videoActionBtn}
                      >
                        <Text style={styles.videoActionBtnIcon}>🎥</Text>
                        <Text style={styles.videoActionBtnText}>Record Video</Text>
                      </Pressable>
                      <Pressable onPress={handlePickVideoFromLibrary} style={styles.videoActionBtn}>
                        <Text style={styles.videoActionBtnIcon}>📁</Text>
                        <Text style={styles.videoActionBtnText}>Choose from Library</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                <Pressable
                  onPress={handlePublish}
                  disabled={loading || anyMediaBusy}
                  style={[styles.publishButton, (loading || anyMediaBusy) && styles.publishButtonDisabled]}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.publishButtonText}>SAVE CHANGES</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </>
      ) : (
        <>
          {/* ---- New listing: 3-screen posting flow ---- */}
          {postFlow === 'select' && (
            cameraPermission?.granted ? (
              // Step 1 IS the camera — it opens the instant the Sell tab is
              // reached, no "Camera vs Gallery" choice screen first. Gallery
              // is reachable as a small icon within this same view, matching
              // how modern camera-first posting flows (Instagram/TikTok/
              // Snapchat's create tab) are laid out.
              <View style={styles.wizardCameraContainer}>
                <CameraView
                  ref={wizardCameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={wizardCameraFacing}
                  mode={wizardCameraMode === 'photo' ? 'picture' : 'video'}
                />

                <SafeAreaView style={styles.wizardCameraTopBar} edges={['top']}>
                  <Pressable
                    onPress={() => ((images.length > 0 || video) ? setPostFlow('edit') : navigation.navigate('Home'))}
                    style={styles.cameraCloseBtn}
                    disabled={wizardIsRecording}
                  >
                    <Text style={styles.cameraCloseBtnText}>✕</Text>
                  </Pressable>

                  {wizardIsRecording ? (
                    <View style={styles.recordingTimerBadge}>
                      <View style={styles.recordingDot} />
                      <Text style={styles.recordingTimerText}>{wizardRecordingSeconds}s / {MAX_VIDEO_DURATION_SECONDS}s</Text>
                    </View>
                  ) : (
                    <View style={styles.cameraModeToggle}>
                      <Pressable onPress={() => setWizardCameraMode('photo')} style={[styles.cameraModeToggleBtn, wizardCameraMode === 'photo' && styles.cameraModeToggleBtnActive]}>
                        <Text style={[styles.cameraModeToggleText, wizardCameraMode === 'photo' && styles.cameraModeToggleTextActive]}>Photo</Text>
                      </Pressable>
                      <Pressable onPress={() => setWizardCameraMode('video')} style={[styles.cameraModeToggleBtn, wizardCameraMode === 'video' && styles.cameraModeToggleBtnActive]}>
                        <Text style={[styles.cameraModeToggleText, wizardCameraMode === 'video' && styles.cameraModeToggleTextActive]}>Video</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Camera flip control lives in the bottom bar now (next to
                      the shutter, bottom-right) — this spacer just keeps the
                      Photo/Video toggle visually centered without it. */}
                  <View style={{ width: 38 }} />
                </SafeAreaView>

                <SafeAreaView style={styles.wizardCameraBottomBar} edges={['bottom']}>
                  {(images.length > 0 || video) && (
                    <Pressable onPress={() => setPostFlow('edit')} style={styles.wizardResumeThumbBadge}>
                      <Text style={styles.wizardResumeThumbBadgeText}>{images.length + (video ? 1 : 0)}</Text>
                    </Pressable>
                  )}
                  <View style={styles.wizardCameraBottomRow}>
                    <Pressable onPress={handleWizardPickFromGallery} style={styles.wizardGalleryBtn} disabled={wizardIsRecording}>
                      {recentGalleryThumb ? (
                        <>
                          <Image source={{ uri: recentGalleryThumb.uri }} style={styles.wizardGalleryThumbImg} />
                          {recentGalleryThumb.isVideo && (
                            <View style={styles.wizardGalleryThumbVideoBadge}>
                              <Text style={styles.wizardGalleryThumbVideoBadgeText}>▶</Text>
                            </View>
                          )}
                        </>
                      ) : (
                        <Text style={styles.wizardGalleryBtnIcon}>🖼️</Text>
                      )}
                    </Pressable>

                    {wizardCameraMode === 'photo' ? (
                      <Pressable onPress={handleWizardTakePhoto} disabled={wizardIsCapturingPhoto} style={styles.recordButton}>
                        {wizardIsCapturingPhoto && <ActivityIndicator size="small" color="#0f172a" />}
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={wizardIsRecording ? handleWizardStopRecording : handleWizardStartRecording}
                        style={[styles.recordButton, wizardIsRecording && styles.recordButtonActive]}
                      >
                        {wizardIsRecording && <View style={styles.recordButtonStopIcon} />}
                      </Pressable>
                    )}

                    <Pressable
                      onPress={() => setWizardCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
                      style={styles.wizardFlipBtn}
                      disabled={wizardIsRecording}
                    >
                      <RefreshCw size={30} color="#ffffff" strokeWidth={2.8} />
                    </Pressable>
                  </View>
                  <Text style={styles.cameraHintText}>
                    {wizardCameraMode === 'photo' ? 'Tap to take photo' : wizardIsRecording ? 'Tap to stop' : 'Tap to start recording'}
                  </Text>
                </SafeAreaView>
              </View>
            ) : (
              <View style={styles.wizardContainer}>
                <View style={styles.header}>
                  <Text style={styles.title}>Post an Ad</Text>
                  <Text style={styles.subtitle}>Step 1 of 3 — Add a photo or video of your item</Text>
                </View>
                <View style={styles.selectBody}>
                  <Text style={styles.permissionEmoji}>📷</Text>
                  <Text style={styles.selectBigBtnTitle}>Camera Access Needed</Text>
                  <Text style={styles.permissionExplainerText}>
                    TedBuy needs camera access so you can take a photo or record a video for your listing.
                    {cameraPermission?.canAskAgain === false ? ' You previously denied this — enable it in your device Settings to continue.' : ''}
                  </Text>
                  <Pressable
                    onPress={() => (cameraPermission?.canAskAgain === false ? Linking.openSettings() : requestCameraPermission())}
                    style={styles.selectBigBtn}
                  >
                    <Text style={styles.selectBigBtnTitle}>{cameraPermission?.canAskAgain === false ? 'Open Settings' : 'Grant Camera Access'}</Text>
                  </Pressable>
                  <Pressable onPress={handleWizardPickFromGallery} style={styles.selectBigBtn}>
                    <Text style={styles.selectBigBtnIcon}>🖼️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectBigBtnTitle}>Choose from Gallery Instead</Text>
                      <Text style={styles.selectBigBtnSubtitle}>Pick a photo or video you already have</Text>
                    </View>
                  </Pressable>
                </View>
              </View>
            )
          )}

          {postFlow === 'edit' && (
            <View style={styles.wizardContainer}>
              <View style={styles.wizardTopBar}>
                <Pressable onPress={handleBackToSelect} style={styles.wizardBackBtn}>
                  <Text style={styles.wizardBackBtnText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.wizardStepLabel}>Step 2 of 3 — Preview & Edit</Text>
                <View style={{ width: 50 }} />
              </View>

              <ScrollView contentContainerStyle={styles.editBody} keyboardShouldPersistTaps="handled">
                {images.length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={styles.editSectionLabel}>PHOTOS — tap one to crop</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {images.map((img) => (
                          <Pressable key={img.id} onPress={() => setCropTargetId(img.id)} style={styles.editThumbWrapper}>
                            <Image source={{ uri: img.localUri }} style={styles.editThumb} />
                            <View style={styles.editThumbCropBadge}>
                              <Text style={styles.editThumbCropBadgeText}>✎</Text>
                            </View>
                            <Pressable onPress={() => handleRemoveImage(img.id)} style={styles.removePhotoBtn} hitSlop={6}>
                              <Text style={styles.removePhotoBtnText}>✕</Text>
                            </Pressable>
                          </Pressable>
                        ))}
                        {images.length < MAX_IMAGES && !video && (
                          <Pressable onPress={() => setPostFlow('select')} style={styles.addPhotoBtn}>
                            <Text style={styles.addPhotoBtnIcon}>+</Text>
                            <Text style={styles.addPhotoBtnText}>Add More</Text>
                          </Pressable>
                        )}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {video && (
                  <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={styles.editSectionLabel}>VIDEO — trim the usable part</Text>
                      <Pressable onPress={handleRemoveVideo}>
                        <Text style={styles.editRemoveVideoText}>Remove</Text>
                      </Pressable>
                    </View>
                    <VideoTrimEditor
                      uri={video.localUri}
                      trimStart={video.trimStart}
                      trimEnd={video.trimEnd}
                      onDurationReady={handleVideoDurationReady}
                      onSetStart={(s) => setVideo((prev) => (prev ? { ...prev, trimStart: s } : prev))}
                      onSetEnd={(s) => setVideo((prev) => (prev ? { ...prev, trimEnd: s } : prev))}
                    />
                  </View>
                )}

                {images.length === 0 && !video && (
                  <View style={styles.editEmptyState}>
                    <Text style={styles.editEmptyText}>Nothing selected yet.</Text>
                    <Pressable onPress={handleBackToSelect} style={styles.selectBigBtn}>
                      <Text style={styles.selectBigBtnTitle}>Go back and add media</Text>
                    </Pressable>
                  </View>
                )}
              </ScrollView>

              <View style={[styles.wizardBottomBar, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom }]}>
                <Pressable
                  onPress={handleContinueToDetails}
                  disabled={images.length === 0 && !video}
                  style={[styles.wizardPrimaryBtn, images.length === 0 && !video && styles.wizardPrimaryBtnDisabled]}
                >
                  <Text style={styles.wizardPrimaryBtnText}>Continue</Text>
                </Pressable>
              </View>

              {/* Crop sub-view — presented as its own full-screen step over
                  Screen 2 while a specific photo is being edited. */}
              <Modal visible={!!cropTargetId} animationType="fade" onRequestClose={() => setCropTargetId(null)}>
                <SafeAreaView style={styles.cropContainer}>
                  <View style={styles.wizardTopBar}>
                    <Pressable onPress={() => setCropTargetId(null)} style={styles.wizardBackBtn}>
                      <Text style={[styles.wizardBackBtnText, { color: '#ffffff' }]}>Done</Text>
                    </Pressable>
                    <Text style={[styles.wizardStepLabel, { color: '#ffffff' }]}>Crop Photo</Text>
                    <View style={{ width: 50 }} />
                  </View>
                  {cropTargetId && (
                    <>
                      <View style={styles.cropPreviewWrap}>
                        <Image
                          source={{ uri: images.find((i) => i.id === cropTargetId)?.localUri }}
                          style={styles.cropPreviewImg}
                          resizeMode="contain"
                        />
                      </View>
                      <View style={styles.cropRatioRow}>
                        {(['original', 'square', 'portrait'] as CropRatio[]).map((ratio) => {
                          const current = images.find((i) => i.id === cropTargetId)?.cropRatio;
                          const label = ratio === 'original' ? 'Original' : ratio === 'square' ? 'Square (1:1)' : 'Portrait (4:5)';
                          return (
                            <Pressable
                              key={ratio}
                              onPress={() => cropTargetId && applyCropRatio(cropTargetId, ratio)}
                              style={[styles.cropRatioBtn, current === ratio && styles.cropRatioBtnActive]}
                            >
                              <Text style={[styles.cropRatioBtnText, current === ratio && styles.cropRatioBtnTextActive]}>{label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}
                </SafeAreaView>
              </Modal>
            </View>
          )}

          {postFlow === 'details' && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
              <View style={styles.wizardTopBar}>
                <Pressable onPress={() => setPostFlow('edit')} style={styles.wizardBackBtn}>
                  <Text style={styles.wizardBackBtnText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.wizardStepLabel}>Step 3 of 3 — Listing Details</Text>
                <Pressable onPress={handleDiscard}>
                  <Text style={styles.wizardDiscardText}>Discard</Text>
                </Pressable>
              </View>

              <ScrollView
                ref={commonFieldsScrollRef}
                contentContainerStyle={[styles.contentContainer, { paddingBottom: 32 + TAB_BAR_HEIGHT + insets.bottom }]}
                keyboardShouldPersistTaps="handled"
              >
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {images.map((img) => (
                    <Image key={img.id} source={{ uri: img.localUri }} style={styles.detailsThumb} />
                  ))}
                  {video && <VideoPreviewThumbnail uri={video.localUri} />}
                </View>

                <View style={styles.formCard}>
                  <Text style={styles.formSectionTitle}>
                    {selectedCategory === 'Jobs & Employment' ? 'JOB VACANCY DETAILS' : 'LISTING SPECIFICATIONS'}
                  </Text>

                  {renderCommonFields(commonFieldsScrollRef)}

                  {!isEditMode && (
                    <Pressable
                      onPress={() => setPostOption((prev) => (prev === 'boost' ? 'normal' : 'boost'))}
                      style={[styles.boostOptionCard, postOption === 'boost' && styles.boostOptionCardActive]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.boostOptionTitle}>Boost Listing</Text>
                        <View style={[styles.negotiableCheckbox, postOption === 'boost' && styles.negotiableCheckboxChecked]}>
                          {postOption === 'boost' && <Text style={styles.negotiableCheckMark}>✓</Text>}
                        </View>
                      </View>
                      <Text style={styles.boostOptionSubtitle}>Place your ad at the absolute top of the feed</Text>
                    </Pressable>
                  )}

                  <Pressable
                    onPress={handlePublish}
                    disabled={loading || anyMediaBusy}
                    style={[styles.publishButton, (loading || anyMediaBusy) && styles.publishButtonDisabled]}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.publishButtonText}>
                        {anyMediaBusy ? 'UPLOADING MEDIA…' : selectedCategory === 'Jobs & Employment' ? 'POST JOB VACANCY' : 'PUBLISH CLASSIFIED AD'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </>
      )}

      {/* Camera Modal — shared by edit mode's "Record Video" button and the
          new wizard's Screen 1 "Camera" entry, via openCamera(). */}
      <Modal visible={showCameraModal} animationType="slide" onRequestClose={() => !isRecording && setShowCameraModal(false)}>
        <View style={styles.cameraModalContainer}>
          {cameraPermission?.granted && (
            <CameraView ref={cameraRef} style={styles.cameraView} facing="back" mode={cameraMode === 'photo' ? 'picture' : 'video'} />
          )}
          <View style={styles.cameraTopBar}>
            <Pressable
              onPress={() => !isRecording && setShowCameraModal(false)}
              style={styles.cameraCloseBtn}
              disabled={isRecording}
            >
              <Text style={styles.cameraCloseBtnText}>✕</Text>
            </Pressable>
            {isRecording && (
              <View style={styles.recordingTimerBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingTimerText}>
                  {recordingSeconds}s / {MAX_VIDEO_DURATION_SECONDS}s
                </Text>
              </View>
            )}
            {cameraModeToggleable && !isRecording && (
              <View style={styles.cameraModeToggle}>
                <Pressable
                  onPress={() => setCameraMode('photo')}
                  style={[styles.cameraModeToggleBtn, cameraMode === 'photo' && styles.cameraModeToggleBtnActive]}
                >
                  <Text style={[styles.cameraModeToggleText, cameraMode === 'photo' && styles.cameraModeToggleTextActive]}>Photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => setCameraMode('video')}
                  style={[styles.cameraModeToggleBtn, cameraMode === 'video' && styles.cameraModeToggleBtnActive]}
                >
                  <Text style={[styles.cameraModeToggleText, cameraMode === 'video' && styles.cameraModeToggleTextActive]}>Video</Text>
                </Pressable>
              </View>
            )}
          </View>
          <View style={styles.cameraBottomBar}>
            {cameraMode === 'photo' ? (
              <Pressable onPress={handleTakePhoto} disabled={isCapturingPhoto} style={styles.recordButton}>
                {isCapturingPhoto && <ActivityIndicator size="small" color="#0f172a" />}
              </Pressable>
            ) : (
              <Pressable
                onPress={isRecording ? handleStopRecording : handleStartRecording}
                style={[styles.recordButton, isRecording && styles.recordButtonActive]}
              >
                {isRecording && <View style={styles.recordButtonStopIcon} />}
              </Pressable>
            )}
            <Text style={styles.cameraHintText}>
              {cameraMode === 'photo' ? 'Tap to take photo' : isRecording ? 'Tap to stop' : 'Tap to start recording'}
            </Text>
          </View>
        </View>
      </Modal>

      <EmailVerificationModal
        visible={blockedActionType !== null}
        actionType={blockedActionType}
        onClose={() => setBlockedActionType(null)}
        onVerified={() => setCurrentUserProfile((prev: any) => (prev ? { ...prev, emailVerified: true } : prev))}
      />

      <BoostModal
        visible={boostingProduct !== null}
        product={boostingProduct}
        isAdmin={isUserAdmin(currentUserProfile)}
        onClose={() => { setBoostingProduct(null); navigation.navigate('Home'); }}
        onSuccess={() => { setBoostingProduct(null); navigation.navigate('Home'); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#020617' },
  title: { color: '#ffffff', fontSize: 24, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  subtitle: { color: '#94a3b8', marginTop: 4, fontSize: 13, lineHeight: 18, fontFamily: fonts.medium },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  authLockCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    marginTop: 40,
  },
  lockEmoji: { fontSize: 44, marginBottom: 16 },
  lockTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: '#1e293b', marginBottom: 8 },
  lockText: { fontSize: 13.5, color: '#64748b', textAlign: 'center', lineHeight: 20, marginBottom: 20, fontFamily: fonts.medium },
  authButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    height: 48,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  authButtonText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 0.8 },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  formSectionTitle: {
    color: '#ea580c',
    fontSize: 10,
    fontFamily: fonts.extrabold,
    letterSpacing: 1.2,
    marginBottom: 16,
  },
  inputGroup: { marginBottom: 16 },
  label: { color: '#475569', fontSize: 12.5, fontFamily: fonts.bold, marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0f172a',
    fontFamily: fonts.medium,
  },
  priceInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  pricePrefix: { color: '#0f172a', fontSize: 14, fontFamily: fonts.bold },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  negotiableCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  negotiableCheckboxChecked: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  negotiableCheckMark: { color: '#ffffff', fontSize: 11, fontFamily: fonts.extrabold },
  negotiableRowText: { fontSize: 12.5, color: '#334155', fontFamily: fonts.semibold },
  conditionClearText: { fontSize: 11, color: '#94a3b8', fontFamily: fonts.semibold, textDecorationLine: 'underline' },
  boostOptionCard: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 14, marginBottom: 14 },
  boostOptionCardActive: { borderColor: '#fbbf24', backgroundColor: '#fffbeb' },
  boostOptionTitle: { fontSize: 13, color: '#92400e', fontFamily: fonts.extrabold },
  boostOptionSubtitle: { fontSize: 10.5, color: '#a16207', fontFamily: fonts.medium, marginTop: 3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  locationPillRow: { flexDirection: 'row', gap: 6, marginTop: 4, paddingRight: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  chipText: { color: '#475569', fontSize: 12, fontFamily: fonts.semibold },
  chipTextActive: { color: '#ffffff', fontFamily: fonts.bold },
  textArea: { height: 120, paddingTop: 10, paddingBottom: 10 },
  toggleRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  toggleTitle: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: '#1e293b',
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 14,
  },
  publishButton: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  publishButtonDisabled: { backgroundColor: '#cbd5e1' },
  publishButtonText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 0.8 },

  photoHint: { fontSize: 11, color: '#94a3b8', marginBottom: 10, marginTop: -2, lineHeight: 15 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrapper: {
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  photoThumb: { width: '100%', height: '100%', resizeMode: 'cover' },
  coverBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  coverBadgeText: { color: '#ffffff', fontSize: 8, fontFamily: fonts.extrabold, letterSpacing: 0.3 },
  photoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  photoOverlayError: { backgroundColor: 'rgba(220, 38, 38, 0.75)' },
  photoOverlayText: { color: '#ffffff', fontSize: 10, fontFamily: fonts.extrabold },
  retryBtn: { backgroundColor: '#ffffff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  retryBtnText: { color: '#dc2626', fontSize: 10, fontFamily: fonts.extrabold },
  removePhotoBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoBtnText: { color: '#ffffff', fontSize: 9, fontFamily: fonts.extrabold },
  addPhotoBtn: {
    width: 84,
    height: 84,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  addPhotoBtnIcon: { fontSize: 22, color: '#64748b', fontFamily: fonts.regular },
  addPhotoBtnText: { fontSize: 9.5, color: '#64748b', fontFamily: fonts.bold, marginTop: 2 },

  videoActionRow: { flexDirection: 'row', gap: 10 },
  videoActionBtn: {
    flex: 1,
    height: 84,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  videoActionBtnIcon: { fontSize: 22 },
  videoActionBtnText: { fontSize: 10.5, color: '#64748b', fontFamily: fonts.bold, marginTop: 4, textAlign: 'center', paddingHorizontal: 6 },

  cameraModalContainer: { flex: 1, backgroundColor: '#000000' },
  cameraView: { flex: 1 },
  cameraTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraCloseBtnText: { color: '#ffffff', fontSize: 16, fontFamily: fonts.bold },
  cameraModeToggle: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 3, gap: 2 },
  cameraModeToggleBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  cameraModeToggleBtnActive: { backgroundColor: '#ffffff' },
  cameraModeToggleText: { color: '#ffffff', fontSize: 11, fontFamily: fonts.bold },
  cameraModeToggleTextActive: { color: '#0f172a', fontFamily: fonts.extrabold },
  recordingTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  recordingTimerText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  cameraBottomBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ffffff',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#ef4444' },
  recordButtonStopIcon: { width: 22, height: 22, borderRadius: 4, backgroundColor: '#ffffff' },
  cameraHintText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.semibold },

  // ---- New 3-screen posting wizard ----
  wizardContainer: { flex: 1, backgroundColor: '#f8fafc' },
  wizardTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#020617',
  },
  wizardBackBtn: { minWidth: 50 },
  wizardBackBtnText: { color: '#ffffff', fontSize: 13, fontFamily: fonts.bold },
  wizardStepLabel: { color: '#94a3b8', fontSize: 11, fontFamily: fonts.extrabold, textTransform: 'uppercase', letterSpacing: 0.5 },
  wizardDiscardText: { color: '#f87171', fontSize: 13, fontFamily: fonts.bold },
  wizardPrimaryBtn: { backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 15, alignItems: 'center', margin: 16 },
  wizardPrimaryBtnDisabled: { backgroundColor: '#cbd5e1' },
  wizardPrimaryBtnText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 13, letterSpacing: 0.6 },
  wizardBottomBar: { backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },

  selectBody: { flex: 1, padding: 20, gap: 14, alignItems: 'center', justifyContent: 'center' },
  selectBigBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 18, padding: 18, width: '100%' },
  selectBigBtnIcon: { fontSize: 30 },
  selectBigBtnTitle: { fontSize: 15, color: '#0f172a', fontFamily: fonts.extrabold, textAlign: 'center' },
  selectBigBtnSubtitle: { fontSize: 11.5, color: '#64748b', fontFamily: fonts.medium, marginTop: 2 },
  selectHint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8, lineHeight: 16 },
  permissionEmoji: { fontSize: 40, marginBottom: 4 },
  permissionExplainerText: { fontSize: 12.5, color: '#64748b', fontFamily: fonts.medium, textAlign: 'center', lineHeight: 18, marginBottom: 8 },

  // Screen 1's camera-first inline UI
  wizardCameraContainer: { flex: 1, backgroundColor: '#000000' },
  wizardCameraTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wizardCameraBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 18,
    gap: 10,
  },
  wizardCameraBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 30 },
  wizardGalleryBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wizardGalleryBtnIcon: { fontSize: 22 },
  wizardGalleryThumbImg: { width: '100%', height: '100%' },
  wizardGalleryThumbVideoBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardGalleryThumbVideoBadgeText: { color: '#ffffff', fontSize: 8, marginLeft: 1 },
  // No background/border box (unlike wizardGalleryBtn) — just the bare,
  // large glyph. Same 52x52 footprint kept for the tap target only.
  // Circular soft backdrop (not the disliked square box) — matches the
  // close (X) button's own circular language elsewhere on this screen,
  // just larger to comfortably frame the bigger icon.
  wizardFlipBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardResumeThumbBadge: {
    position: 'absolute',
    right: 16,
    bottom: 118,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  wizardResumeThumbBadgeText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.extrabold },

  editBody: { padding: 16, paddingBottom: 32 },
  editSectionLabel: { fontSize: 10.5, color: '#64748b', fontFamily: fonts.extrabold, letterSpacing: 0.6, marginBottom: 8 },
  editThumbWrapper: { width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', position: 'relative' },
  editThumb: { width: '100%', height: '100%', resizeMode: 'cover' },
  editThumbCropBadge: { position: 'absolute', bottom: 4, left: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(15,23,42,0.75)', alignItems: 'center', justifyContent: 'center' },
  editThumbCropBadgeText: { color: '#ffffff', fontSize: 10 },
  editRemoveVideoText: { color: '#dc2626', fontSize: 12, fontFamily: fonts.bold },
  editEmptyState: { alignItems: 'center', gap: 14, paddingTop: 40 },
  editEmptyText: { color: '#64748b', fontSize: 13, fontFamily: fonts.medium },

  trimPlayerWrap: { width: '100%', height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000000', position: 'relative' },
  trimPlayerVideo: { width: '100%', height: '100%' },
  trimPlayOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  trimPlayIcon: { color: '#ffffff', fontSize: 32 },
  trimBarTrack: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, marginTop: 14, position: 'relative', overflow: 'visible' },
  trimBarRange: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#0f172a', borderRadius: 4 },
  trimBarPlayhead: { position: 'absolute', top: -3, width: 3, height: 14, backgroundColor: '#ea580c', borderRadius: 2 },
  trimTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  trimTimeText: { color: '#334155', fontSize: 11, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  trimTimeTextMuted: { color: '#94a3b8', fontSize: 11, fontFamily: fonts.medium },
  trimButtonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  trimMarkBtn: { flex: 1, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  trimMarkBtnText: { color: '#0f172a', fontSize: 12, fontFamily: fonts.extrabold },

  cropContainer: { flex: 1, backgroundColor: '#0f172a' },
  cropPreviewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  cropPreviewImg: { width: '100%', height: '100%' },
  cropRatioRow: { flexDirection: 'row', gap: 10, padding: 20 },
  cropRatioBtn: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cropRatioBtnActive: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  cropRatioBtnText: { color: '#ffffff', fontSize: 12, fontFamily: fonts.bold },
  cropRatioBtnTextActive: { color: '#0f172a', fontFamily: fonts.extrabold },

  detailsThumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#e2e8f0' },
});
