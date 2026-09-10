import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Category, Product, normalizeCategory, CATEGORY_ICONS } from '../types';
import { BoostModal } from './BoostModal';
import { X, Image, Upload, AlertCircle, Plus, Video, Scissors, Loader2, ArrowRight, ArrowLeft, Camera, Star, Check, Sparkles } from 'lucide-react';
import { GHANA_REGIONS } from '../regions';
import { compressImage, downscaleDataUrlForAI } from '../utils/imageOptimizer';
import { validateImageFile } from '../utils/fileValidation';
import { toUserFriendlyError } from '../utils/authErrorHelper';
import { uploadToCloudinary, uploadVideoDirectToCloudinary, cleanupOrphanedCloudinaryAssets, getCloudinaryVideoPoster } from '../utils/cloudinary';
import { resolveProductImages } from '../utils/productUtils';
import { generateListingDescription } from '../utils/aiListingDescription';

interface ListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit?: Product | null;
}

const CATEGORIES: Category[] = [
  'Phones',
  'Laptops & Computers',
  'Fashion',
  'Home Appliances',
  'Vehicles',
  'Property',
  'Furniture & Home',
  'Beauty and Care',
  'Games',
  'Electronics',
  'Services',
  'Jobs & Employment',
  'Agriculture & Food',
  'Pets & Animals',
  'Sports & Fitness',
  'Kids & Baby',
  'Commercial & Tools',
  'Books & Hobbies',
  'Other'
];

export const ListingModal: React.FC<ListingModalProps> = ({ isOpen, onClose, productToEdit }) => {
  const { createProduct, updateProduct, currentUser, setCurrentView, showToast, setSelectedProductId } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [aiDescriptionError, setAiDescriptionError] = useState('');
  const [aiDescriptionWarning, setAiDescriptionWarning] = useState('');
  const lastAiGeneratedTextRef = useRef('');

  // Auto-resize description textarea as user types
  useEffect(() => {
    if (descriptionTextareaRef.current) {
      descriptionTextareaRef.current.style.height = 'auto';
      descriptionTextareaRef.current.style.height = `${Math.max(96, descriptionTextareaRef.current.scrollHeight)}px`;
    }
  }, [description, isOpen]);
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Category>('Phones');
  const [serviceSubCategory, setServiceSubCategory] = useState('Photography and Video Services');
  const [customServiceType, setCustomServiceType] = useState('');
  const [location, setLocation] = useState('');
  const [brand, setBrand] = useState('');
  const [condition, setCondition] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<string[]>([]);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');
  // The raw File/Blob for a newly-selected (not-yet-uploaded) video, kept alongside
  // its base64 form in `videos` so submit can upload the real binary directly to
  // Cloudinary instead of round-tripping through a base64 string. Only ever set for
  // NEW videos selected this session — editing an existing listing's video (already
  // an https:// URL) never populates this.
  const [pendingVideoFile, setPendingVideoFile] = useState<File | Blob | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [isDraggingVideos, setIsDraggingVideos] = useState(false);

  const convertBase64ToBlobUrl = (base64Str: string): string => {
    if (!base64Str) return '';
    if (!base64Str.startsWith('data:')) return base64Str;
    try {
      const parts = base64Str.split(',');
      if (parts.length < 2) return base64Str;
      const header = parts[0];
      let base64Part = parts.slice(1).join(',');

      const mimeMatch = header.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';

      // Decode URL-encoded characters (like %2B -> +, %2F -> /, %3D -> =)
      if (base64Part.includes('%')) {
        try {
          base64Part = decodeURIComponent(base64Part);
        } catch {
          base64Part = base64Part
            .replace(/%2b/gi, '+')
            .replace(/%2f/gi, '/')
            .replace(/%3d/gi, '=');
        }
      }

      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const lookup = new Uint8Array(256);
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }

      // Standardize and sanitize the base64 character string
      let clean = '';
      for (let i = 0; i < base64Part.length; i++) {
        const char = base64Part[i];
        if (char === '-') {
          clean += '+';
        } else if (char === '_') {
          clean += '/';
        } else if (char === '=') {
          break;
        } else {
          const code = base64Part.charCodeAt(i);
          if (
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            (code >= 48 && code <= 57) || // 0-9
            char === '+' ||
            char === '/'
          ) {
            clean += char;
          }
        }
      }

      const len = clean.length;
      if (len === 0) return '';

      const bufferLength = Math.floor(len * 0.75);
      const bytes = new Uint8Array(bufferLength);
      
      let p = 0;
      for (let i = 0; i < len; i += 4) {
        const encoded1 = lookup[clean.charCodeAt(i) || 0];
        const encoded2 = lookup[clean.charCodeAt(i + 1) || 0];
        const encoded3 = lookup[clean.charCodeAt(i + 2) || 0];
        const encoded4 = lookup[clean.charCodeAt(i + 3) || 0];

        const bytesval1 = (encoded1 << 2) | (encoded2 >> 4);
        const bytesval2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        const bytesval3 = ((encoded3 & 3) << 6) | (encoded4 & 63);

        if (p < bufferLength) bytes[p++] = bytesval1;
        if (p < bufferLength) bytes[p++] = bytesval2;
        if (p < bufferLength) bytes[p++] = bytesval3;
      }

      const blob = new Blob([bytes.subarray(0, p)], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn("Failed to convert base64 to blob url in convertBase64ToBlobUrl:", e);
      return base64Str;
    }
  };

  useEffect(() => {
    return () => {
      if (videoPreviewUrl && videoPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  const [oversizedVideoFile, setOversizedVideoFile] = useState<File | null>(null);
  const [oversizedVideoUrl, setOversizedVideoUrl] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(30);
  const [compressionProgress, setCompressionProgress] = useState<number | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [negotiable, setNegotiable] = useState(true);
  const [isExchangeable, setIsExchangeable] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [postOption, setPostOption] = useState<'normal' | 'boost'>('normal');
  const [createdProductForBoost, setCreatedProductForBoost] = useState<Product | null>(null);
  const [rateLimitWaitSeconds, setRateLimitWaitSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (rateLimitWaitSeconds === null || rateLimitWaitSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setRateLimitWaitSeconds(prev => {
        if (prev === null) return null;
        return prev > 1 ? prev - 1 : 0;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [rateLimitWaitSeconds]);

  // Regional state helpers
  const [adRegion, setAdRegion] = useState('Greater Accra');
  const [adCity, setAdCity] = useState('Accra');
  const [adNeighborhood, setAdNeighborhood] = useState('');

  // Synchronize adCity when adRegion changes
  const activeRegionObj = GHANA_REGIONS.find(r => r.name === adRegion);
  useEffect(() => {
    if (activeRegionObj && !activeRegionObj.cities.includes(adCity)) {
      setAdCity(activeRegionObj.cities[0] || '');
    }
  }, [adRegion]);

  // Initialize form if editing
  //
  // productToEdit, as passed in from a listing grid (Seller Dashboard),
  // only ever carries the feed-summary shape (serializeProductSummary
  // server-side) — it never has description at all, and only a single
  // displayImage rather than the full images[] array, by design, to keep
  // feed payloads small. Seeding directly from that object opened the edit
  // form with description and photos genuinely missing even though the
  // listing had both — and worse, saving from that state would have
  // overwritten the real values with nothing. seedFrom below always runs
  // once immediately (so the form isn't blank while a fetch is in flight),
  // then again once the full record has been fetched by id.
  useEffect(() => {
    const seedFrom = (productToEdit: Product) => {
      setTitle(productToEdit.title);
      setDescription(productToEdit.description);

      let editPrice = productToEdit.price.toString();
      if (editPrice.trim().toLowerCase() === 'contact for price') {
        editPrice = 'Inquire';
      }
      setPrice(editPrice);
      // Standardize category casing for UI/database uniformity
      const rawCat = productToEdit.category;
      const normalizedCat = normalizeCategory(rawCat);
      setCategory(normalizedCat);
      setLocation(productToEdit.location);
      const initialEditImages = resolveProductImages(productToEdit);
      setImages(initialEditImages);
      const editVids = productToEdit.videos || [];
      setVideos(editVids);
      if (editVids.length > 0) {
        setVideoPreviewUrl(convertBase64ToBlobUrl(editVids[0]));
      } else {
        setVideoPreviewUrl('');
      }
      // Editing loads an already-uploaded https:// video URL, never a new local
      // file, so there is nothing pending to direct-upload until the user picks
      // a replacement.
      setPendingVideoFile(null);
      setBrand(productToEdit.brand || '');
      setCondition(productToEdit.condition || '');
      setNegotiable(productToEdit.negotiable !== false); // Default to true if undefined or true
      setIsExchangeable(!!(productToEdit.isExchangeable || productToEdit.exchangePossible));

      if (normalizedCat === 'Services') {
        const bd = productToEdit.brand || '';
        const standardServices = [
          'Photography and Video Services',
          'Computer or IT Services',
          'Fashion Services'
        ];
        if (standardServices.includes(bd)) {
          setServiceSubCategory(bd);
          setCustomServiceType('');
        } else if (bd.trim() !== '') {
          setServiceSubCategory('Other');
          setCustomServiceType(bd);
        } else {
          setServiceSubCategory('Photography and Video Services');
          setCustomServiceType('');
        }
      } else {
        setServiceSubCategory('Photography and Video Services');
        setCustomServiceType('');
      }

      // Try to back-parse the product's location (e.g. "East Legon, Accra")
      const locVal = productToEdit.location;
      let foundRegion = 'Greater Accra';
      let foundCity = 'Accra';
      let foundNeighborhood = '';

      // Check which region/city matches
      for (const reg of GHANA_REGIONS) {
        let matchedReg = false;
        if (locVal.toLowerCase().includes(reg.name.toLowerCase())) {
          foundRegion = reg.name;
          matchedReg = true;
        }
        for (const city of reg.cities) {
          if (locVal.toLowerCase().includes(city.toLowerCase())) {
            foundCity = city;
            foundRegion = reg.name;
            matchedReg = true;
            break;
          }
        }
        if (matchedReg) break;
      }

      // If location is "East Legon, Accra", extract "East Legon" as neighborhood
      const parts = locVal.split(',');
      if (parts.length > 1) {
        foundNeighborhood = parts[0].trim();
      }

      setAdRegion(foundRegion);
      setAdCity(foundCity);
      setAdNeighborhood(foundNeighborhood);
      if (productToEdit.videos && productToEdit.videos.length > 0) {
        setMediaType('video');
      } else {
        setMediaType('image');
      }
    };

    if (productToEdit) {
      seedFrom(productToEdit);
      let active = true;
      fetch(`/api/products/${productToEdit.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (active && data?.success && data.product) {
            seedFrom(data.product);
          }
        })
        .catch(() => {});
      // active just guards against a stale fetch resolving after a newer
      // productToEdit (or the modal closing) has already re-run this effect.
      return () => { active = false; };
    } else {
      // Clear fields
      setTitle('');
      setDescription('');
      setPrice('');
      setCategory('Phones');
      setServiceSubCategory('Photography and Video Services');
      setCustomServiceType('');
      setLocation('');
      setBrand('');
      setCondition('');
      setImages([]);
      setVideos([]);
      setVideoPreviewUrl('');
      setPendingVideoFile(null);
      setOversizedVideoFile(null);
      setMediaType('image');
      setAdRegion('Greater Accra');
      setAdCity('Accra');
      setAdNeighborhood('');
      setNegotiable(true);
    }
    setErrorMsg('');
  }, [productToEdit, isOpen]);

  // Object URL and trim-range reset for the video editor. Duration itself is
  // read from the visible player's own loadedmetadata event (see
  // onLoadedMetadata below) rather than a detached probe element here — a
  // hidden, unattached <video> with no preload/muted/playsInline set is
  // unreliable on mobile browsers and could leave videoDuration stuck at 0.
  useEffect(() => {
    if (oversizedVideoFile) {
      const url = URL.createObjectURL(oversizedVideoFile);
      setOversizedVideoUrl(url);
      setTrimStart(0);
      setTrimEnd(30); // optimistic default; corrected to the real duration by onLoadedMetadata

      return () => {
        URL.revokeObjectURL(url);
        setOversizedVideoUrl('');
      };
    } else {
      setOversizedVideoUrl('');
      setVideoDuration(0);
      setTrimStart(0);
      setTrimEnd(30);
    }
  }, [oversizedVideoFile]);

  if (!isOpen) return null;

  const handleCancelOrBack = () => {
    const hasData = title.trim() || description.trim() || images.length > 0 || videos.length > 0;
    if (hasData && !productToEdit) {
      if (!window.confirm("You have unsaved changes in your listing. Are you sure you want to leave?")) {
        return;
      }
    }
    onClose();
  };

  const handleImageFiles = (filesList: File[]) => {
    setErrorMsg('');
    if (!filesList || filesList.length === 0) return;

    const remainingSpots = 10 - images.length;
    if (filesList.length > remainingSpots) {
      setErrorMsg(`You can only upload up to 10 images. You have ${images.length} uploaded, meaning you can add ${remainingSpots} more.`);
      return;
    }

    filesList.forEach(async (file) => {
      const validation = validateImageFile(file);
      if (!validation.isValid) {
        setErrorMsg(validation.error || 'Invalid image file.');
        return;
      }

      try {
        const compressed = await compressImage(file, 1200, 1200, 0.80);
        setImages((prev) => [...prev, compressed]);
      } catch (err) {
        console.error('Failed to compress image:', err);
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setImages((prev) => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleImageFiles(Array.from(e.target.files));
    }
  };

  const makePrimaryImage = (indexToPromote: number) => {
    if (indexToPromote <= 0 || indexToPromote >= images.length) return;
    setImages((prev) => {
      const updated = [...prev];
      const [selected] = updated.splice(indexToPromote, 1);
      updated.unshift(selected);
      return updated;
    });
    showToast("Cover photo set as primary!", "success");
  };

  const removeImage = (indexToRemove: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const dataURLtoFile = (dataurl: string, filename: string): File => {
    try {
      const parts = dataurl.split(',');
      if (parts.length < 2) throw new Error("Invalid base64 structure");
      const header = parts[0];
      let base64Part = parts.slice(1).join(',');

      const mimeMatch = header.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';

      // 1. URL Decode percent-encoded characters like %2B, %2F, %3D
      if (base64Part.includes('%')) {
        try {
          base64Part = decodeURIComponent(base64Part);
        } catch (e) {
          base64Part = base64Part
            .replace(/%2b/gi, '+')
            .replace(/%2f/gi, '/')
            .replace(/%3d/gi, '=');
        }
      }

      // 2. Normalize base64url characters (- to +, _ to /)
      base64Part = base64Part.replace(/-/g, '+').replace(/_/g, '/');

      // 3. Strip any whitespace, quotes and non-base64 characters
      base64Part = base64Part.replace(/[^A-Za-z0-9+/=]/g, '');

      // 4. Correct missing padding
      const bytesNeeded = base64Part.length % 4;
      if (bytesNeeded > 0) {
        base64Part += '='.repeat(4 - bytesNeeded);
      }

      const bstr = atob(base64Part);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime });
    } catch (e) {
      console.warn("Manual dataURLtoFile conversion warning:", e);
      throw e;
    }
  };

  const handleReeditVideo = async (vidStr: string) => {
    try {
      setErrorMsg('');
      // Use fetch which natively supports decoding data-URIs as well as remote URLs
      const res = await fetch(vidStr);
      const blob = await res.blob();
      const file = new File([blob], 'ad_demo_video.mp4', { type: blob.type || 'video/mp4' });
      setOversizedVideoFile(file);
    } catch (err: any) {
      console.error('Failed to resolve video URL via fetch, attempting manual base64 decode fallback:', err);
      try {
        if (vidStr.startsWith('data:')) {
          const file = dataURLtoFile(vidStr, 'ad_demo_video.mp4');
          setOversizedVideoFile(file);
        } else {
          throw new Error("Cannot decode remote HTTP URL manually.");
        }
      } catch (fallbackErr) {
        console.error('All video conversion methods failed:', fallbackErr);
        setErrorMsg('Could not process video for editing. Try uploading the original file again.');
      }
    }
  };

  const processVideoFile = (file: File) => {
    setErrorMsg('');
    if (!file) return;

    if (videos.length >= 1) {
      setErrorMsg(`You can only upload 1 video. Please remove the existing video first.`);
      return;
    }

    const isVideoExtension = /\.(mp4|webm|mov|m4v|3gp|mkv|avi|quicktime)$/i.test(file.name);
    if (!file.type.startsWith('video/') && !isVideoExtension) {
      setErrorMsg('Only video files (MP4, WEBM, MOV) are supported.');
      return;
    }

    if (file.size > 18 * 1024 * 1024) {
      setErrorMsg(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Videos larger than 18MB must be trimmed/optimized below before posting.`);
    }
    setOversizedVideoFile(file);
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processVideoFile(files[0]);
  };

  const compressVideoFile = async (file: File) => {
    setIsCompressing(true);
    setCompressionProgress(0);
    setErrorMsg('');

    let video: HTMLVideoElement | null = null;
    let videoUrl = '';

    try {
      videoUrl = URL.createObjectURL(file);
      video = document.createElement('video');
      video.src = videoUrl;
      video.muted = false;
      video.volume = 1;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', 'true');
      video.crossOrigin = 'anonymous';
      
      // Crucial: Append the video offscreen so modern browsers (Chrome/Safari)
      // actively allocate hardware decoder resources and allow smooth rendering of frames to canvas.
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      video.style.width = '360px';
      video.style.height = '360px';
      video.style.pointerEvents = 'none';
      video.style.opacity = '0.001';
      document.body.appendChild(video);

      // Load metadata
      await new Promise<void>((resolve, reject) => {
        if (!video) return reject();
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Unable to read video metadata"));
      });

      const duration = video.duration;
      if (isNaN(duration) || duration === 0) {
        throw new Error("Unable to read video duration.");
      }

      // Format size to ~540p for gorgeous high-resolution layout on mobile
      let targetWidth = 540;
      let targetHeight = 540;
      const originalWidth = video.videoWidth || 640;
      const originalHeight = video.videoHeight || 480;

      if (originalWidth > originalHeight) {
        targetHeight = Math.round((originalHeight * 540) / originalWidth);
      } else {
        targetWidth = Math.round((originalWidth * 540) / originalHeight);
      }

      if (targetWidth % 2 !== 0) targetWidth++;
      if (targetHeight % 2 !== 0) targetHeight++;

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error("Canvas context is not supported");
      }

      // Enable high-quality image smoothing (bicubic downscaling)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Capture standard stream at up to 24 fps for smoother fluid motion
      const targetFPS = 24;
      const stream = canvas.captureStream(targetFPS);

      let audioCtx: AudioContext | null = null;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          const audioTrack = dest.stream.getAudioTracks()[0];
          if (audioTrack) {
            stream.addTrack(audioTrack);
          }
        }
      } catch (audioErr) {
        console.warn("Could not attach audio track during compression:", audioErr);
      }
      
      const mimeTypes = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm'
      ];
      
      let chosenMime = '';
      for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          chosenMime = mime;
          break;
        }
      }

      if (!chosenMime) {
        throw new Error("No web-compatible recording codecs found in this browser.");
      }

      // Calculate the absolute highest possible bitrate dynamically based on the clip's duration
      // to squeeze the maximum possible visual output under the 6MB base64 capacity limit
      const totalToRecord = trimEnd - trimStart || 5;
      const targetBinaryBytes = 5 * 1024 * 1024; // 5 MB raw binary (perfectly safe under Supabase/PostgREST HTTP payload limits)
      const targetBits = targetBinaryBytes * 8;
      let calculatedBps = Math.floor(targetBits / totalToRecord);
      
      // Cap bitrate between 600,000 bps and 2,500,000 bps for a great balance of clarity and compact file size
      if (calculatedBps < 600000) calculatedBps = 600000;
      if (calculatedBps > 2500000) calculatedBps = 2500000;

      const recorderOptions = {
        mimeType: chosenMime,
        videoBitsPerSecond: calculatedBps
      };

      const recorder = new MediaRecorder(stream, recorderOptions);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };

      const recordPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          const finalBlob = new Blob(chunks, { type: chosenMime });
          resolve(finalBlob);
        };
        recorder.onerror = () => reject(new Error("Recording capture interrupted"));
      });

      // Play video programmatically to draw steps from trimStart
      video.currentTime = trimStart;
      
      // Wait for seeking to complete to prevent canvas blank frames
      await new Promise<void>((resolve) => {
        if (video) {
          video.onseeked = () => resolve();
        } else {
          resolve();
        }
      });

      try {
        await video.play();
      } catch (playErr) {
        console.warn("video.play() was aborted or interrupted, forcing drawing anyway", playErr);
      }

      recorder.start();

      const fpsInterval = 1000 / targetFPS;
      let ticks = 0;
      const maxTicks = Math.round((totalToRecord * targetFPS) * 1.5) + 120; // safety ceiling watchdog

      const intervalId = setInterval(() => {
        if (!video) {
          clearInterval(intervalId);
          return;
        }

        ticks++;
        const reachedEnd = video.currentTime >= trimEnd || video.ended || ticks > maxTicks;
        
        if (reachedEnd) {
          clearInterval(intervalId);
          if (recorder.state === 'recording') {
            recorder.stop();
          }
          video.pause();
          return;
        }

        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const traversed = video.currentTime - trimStart;
        const percent = Math.min(Math.round((traversed / Math.max(0.1, totalToRecord)) * 100), 100);
        setCompressionProgress(percent);
      }, fpsInterval);

      video.onended = () => {
        clearInterval(intervalId);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      };

      const compressedBlob = await recordPromise;

      // Convert to Base64 String
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error("Failed to read compressed file string"));
          }
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(compressedBlob);

      const finalBase64Result = await base64Promise;
      setVideos([finalBase64Result]);
      setPendingVideoFile(compressedBlob);
      // Set the resulting blob URL as the persistent player and preview source
      const finalBlobUrl = URL.createObjectURL(compressedBlob);
      setVideoPreviewUrl(finalBlobUrl);
      setOversizedVideoFile(null);
      setCompressionProgress(null);
      setIsCompressing(false);


    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Failed to compress video automatically: ${err.message || 'transcode process failed'}. Try manual optimization or short 5-second layouts.`);
      setIsCompressing(false);
      setCompressionProgress(null);
    } finally {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      if (video && video.parentNode) {
        video.parentNode.removeChild(video);
      }
    }
  };

  // Confirms the video editor step. Only runs the heavy trim+re-encode
  // pipeline (which downscales to 540p) when there's an actual reason to —
  // the file is genuinely oversized, or the seller actually narrowed the
  // trim range. Otherwise the original file is kept untouched, so a normal
  // video that the seller didn't edit doesn't lose quality for no reason.
  const handleSaveVideoEdit = () => {
    if (!oversizedVideoFile) return;

    const isGenuinelyOversized = oversizedVideoFile.size > 18 * 1024 * 1024;
    const EPSILON = 0.05;
    const isTrimmed = trimStart > EPSILON || (videoDuration > 0 && trimEnd < videoDuration - EPSILON);

    if (!isGenuinelyOversized && !isTrimmed) {
      setIsCompressing(true);
      setCompressionProgress(100);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setVideos([reader.result]);
          setPendingVideoFile(oversizedVideoFile);
          setOversizedVideoFile(null);
          const blobUrl = URL.createObjectURL(oversizedVideoFile);
          setVideoPreviewUrl(blobUrl);
          setIsCompressing(false);
          setCompressionProgress(null);
        }
      };
      reader.onerror = () => {
        setIsCompressing(false);
        setCompressionProgress(null);
        setErrorMsg('Failed to process video file.');
      };
      reader.readAsDataURL(oversizedVideoFile);
      return;
    }

    compressVideoFile(oversizedVideoFile);
  };

  const removeVideo = (indexToRemove: number) => {
    setVideos(prev => prev.filter((_, idx) => idx !== indexToRemove));
    setVideoPreviewUrl('');
    setPendingVideoFile(null);
  };

  const hasMinimumInfoForAi = category.trim().length > 0 && title.trim().length > 0;

  const handleGenerateDescription = async () => {
    if (!hasMinimumInfoForAi || isGeneratingDescription || isSubmitting) return;

    // A description that's non-empty and doesn't match our own last AI
    // output means the seller typed it themselves (from scratch, or by
    // editing a prior generation) — never silently replace that.
    const hasUnprotectedText = description.trim().length > 0 && description !== lastAiGeneratedTextRef.current;
    if (hasUnprotectedText) {
      const confirmed = window.confirm('Replace your current description with an AI-generated one? Your current text will be lost.');
      if (!confirmed) return;
    }

    setAiDescriptionError('');
    setAiDescriptionWarning('');
    setIsGeneratingDescription(true);
    try {
      const compiledLocationForAi = adNeighborhood.trim() ? `${adNeighborhood.trim()}, ${adCity}` : adCity;

      // Derive small AI-only copies of up to 3 already-selected images —
      // never the originals that'll actually be submitted with the listing.
      // `images[]` here is already a compressed data URL (1200px/q0.8) from
      // upload time, so this is a second, smaller re-compression purely for
      // the AI call.
      const imagesForAi = (
        await Promise.all(
          images.slice(0, 3).map((img) => downscaleDataUrlForAI(img).catch(() => null))
        )
      ).filter((v): v is string => !!v);

      const result = await generateListingDescription({
        category,
        title: title.trim(),
        condition: condition || undefined,
        price: price || undefined,
        location: compiledLocationForAi || undefined,
        brand: brand || undefined,
        negotiable,
        isExchangeable,
        existingDescription: description.trim() || undefined,
        images: imagesForAi.length > 0 ? imagesForAi : undefined,
      });

      if (result.success && result.description) {
        setDescription(result.description);
        lastAiGeneratedTextRef.current = result.description;
        if (result.warning) setAiDescriptionWarning(result.warning);
      } else {
        setAiDescriptionError(result.error || "Couldn't generate a description right now. You can write your description manually.");
      }
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setRateLimitWaitSeconds(null);

    // If video is currently in the trimmer editor, clicking Next encodes the video first
    if (oversizedVideoFile) {
      if (isCompressing) return;
      handleSaveVideoEdit();
      return;
    }

    if (category !== 'Services' && !title.trim()) {
      return setErrorMsg(category === 'Jobs & Employment' ? 'Job title is required.' : 'Product title is required.');
    }
    if (title.length > 150) {
      return setErrorMsg(category === 'Jobs & Employment' ? 'Job title must be 150 characters or less.' : 'Product title must be 150 characters or less.');
    }
    if (description.length > 5000) {
      return setErrorMsg('Description must be 5000 characters or less.');
    }
    
    const finalTitle = category === 'Services'
      ? (serviceSubCategory === 'Other' ? (customServiceType.trim() || 'Other Service') : serviceSubCategory)
      : title;

    let parsedPrice: string | number = "Inquire";
    if (category !== 'Services' && category !== 'Jobs & Employment') {
      const rawPrice = price.trim();
      if (!rawPrice) {
        return setErrorMsg('Please enter a price or price details (e.g., Inquire).');
      }

      // Try parsing input to clean number if it is numeric (even with commas)
      const stripCommas = rawPrice.replace(/,/g, '');
      if (!isNaN(Number(stripCommas)) && stripCommas !== '') {
        parsedPrice = Number(stripCommas);
      } else {
        parsedPrice = rawPrice;
      }
    }
    
    // Compile clean location address
    const compiledLocation = adNeighborhood.trim()
      ? `${adNeighborhood.trim()}, ${adCity}`
      : `${adCity}`;

    if (!adCity) {
      return setErrorMsg('Please select a City/Town in Ghana.');
    }
    if (category === 'Services' && serviceSubCategory === 'Other' && !customServiceType.trim()) {
      return setErrorMsg('Please write your service category type since you selected "Other".');
    }
    if (!description.trim()) return setErrorMsg(category === 'Jobs & Employment' ? 'Please write a detailed job description.' : 'Please write a detailed description of the item.');
    
    if (category !== 'Jobs & Employment') {
      if (mediaType === 'image' && images.length === 0) {
        return setErrorMsg('Please upload at least 1 image to describe your product (Max: 10).');
      }
      if (mediaType === 'video' && videos.length === 0) {
        return setErrorMsg('Please upload at least 1 video demonstrating your product ad (Max: 2).');
      }
    }

    const finalImages = images;
    const finalVideos = mediaType === 'video' ? videos : [];

    const finalBrand = category === 'Services'
      ? (serviceSubCategory === 'Other' ? (customServiceType.trim() || 'Other Service') : serviceSubCategory)
      : category === 'Jobs & Employment'
      ? 'Hiring / Employment'
      : brand;
    const finalCondition = category === 'Services' ? 'Service Offered' : category === 'Jobs & Employment' ? 'Job Opening' : condition;
    const finalNegotiable = (category === 'Services' || category === 'Jobs & Employment') ? false : negotiable;
    const finalIsExchangeable = (category === 'Services' || category === 'Jobs & Employment') ? false : isExchangeable;

    const estimateDataStringBytes = (value: string): number => {
      if (!value || typeof value !== 'string') return 0;
      if (value.startsWith('data:')) {
        const commaIndex = value.indexOf(',');
        if (commaIndex === -1) return value.length;
        const base64Part = value.slice(commaIndex + 1).replace(/\s+/g, '');
        const padding = base64Part.endsWith('==') ? 2 : base64Part.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.ceil((base64Part.length * 3) / 4) - padding);
      }
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return 0; // existing remote URLs are not re-uploaded
      }
      return value.length;
    };

    const mediaBytes = [
      ...finalImages.map(img => estimateDataStringBytes(img)),
      ...finalVideos.map(vid => estimateDataStringBytes(vid))
    ].reduce((sum, size) => sum + size, 0);

    const maxBytes = 50 * 1024 * 1024;
    if (mediaBytes > maxBytes) {
      return setErrorMsg(`The total upload payload is too large (${(mediaBytes / (1024 * 1024)).toFixed(1)}MB). Please remove some images or upload a smaller, more compressed video to stay under the 50MB limit.`);
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Phase 1 Cloudinary Media Upload Processing
      setUploadStatus('Uploading media to Cloudinary...');
      
      const cloudinaryImages: string[] = [];
      for (let i = 0; i < finalImages.length; i++) {
        const img = finalImages[i];
        if (img.startsWith('data:') || img.startsWith('blob:')) {
          setUploadStatus(`Uploading image ${i + 1}/${finalImages.length} to Cloudinary...`);
          try {
            const res = await uploadToCloudinary(img, 'image');
            if (res && res.secure_url) {
              cloudinaryImages.push(res.secure_url);
            } else {
              throw new Error(`Cloudinary returned empty response for image ${i + 1}`);
            }
          } catch (uploadErr: any) {
            console.error(`[ListingModal] Cloudinary image upload failed for item ${i}:`, uploadErr);
            throw new Error(`Failed to upload image ${i + 1} to Cloudinary: ${uploadErr?.message || uploadErr}`);
          }
        } else if (img.startsWith('http://') || img.startsWith('https://')) {
          cloudinaryImages.push(img);
        } else {
          throw new Error('Invalid image data format. Please upload a valid image file.');
        }
      }

      const cloudinaryVideos: string[] = [];
      for (let i = 0; i < finalVideos.length; i++) {
        const vid = finalVideos[i];
        if (vid.startsWith('data:') || vid.startsWith('blob:')) {
          setUploadStatus(`Uploading video ${i + 1}/${finalVideos.length} to Cloudinary...`);
          try {
            // Direct-to-Cloudinary path: the raw File/Blob never passes through the
            // TedBuy server, only a short-lived signature does (see
            // /api/cloudinary/sign-video-upload). Falls back to the base64 server
            // relay only in the defensive case where no raw file reference exists
            // (e.g. a video string arrived via some path other than the normal
            // select/compress flow).
            const res = pendingVideoFile
              ? await uploadVideoDirectToCloudinary(pendingVideoFile, (pct) => {
                  setUploadStatus(`Uploading video ${i + 1}/${finalVideos.length} to Cloudinary... (${pct}%)`);
                })
              : await uploadToCloudinary(vid, 'video');
            if (res && res.secure_url) {
              cloudinaryVideos.push(res.secure_url);
            } else {
              throw new Error(`Cloudinary returned empty response for video ${i + 1}`);
            }
          } catch (uploadErr: any) {
            console.error(`[ListingModal] Cloudinary video upload failed for item ${i}:`, uploadErr);
            throw new Error(`Failed to upload video ${i + 1} to Cloudinary: ${uploadErr?.message || uploadErr}`);
          }
        } else if (vid.startsWith('http://') || vid.startsWith('https://')) {
          cloudinaryVideos.push(vid);
        } else {
          throw new Error('Invalid video data format. Please upload a valid video file.');
        }
      }

      // Fallback cover image for video-only listings with no manually-uploaded
      // photos — derived on-the-fly from the uploaded video via Cloudinary's
      // own frame-extraction transform, so no separate poster image needs to
      // be captured, uploaded, or stored.
      const cloudinaryVideoPoster = cloudinaryVideos[0] ? getCloudinaryVideoPoster(cloudinaryVideos[0]) : '';

      setUploadStatus('');

      // If category is Jobs & Employment and no media was provided, let the category SVG placeholder handle it cleanly
      if (category === 'Jobs & Employment' && cloudinaryImages.length === 0 && cloudinaryVideos.length === 0) {
        // Handled cleanly by category SVG placeholder
      }

      if (productToEdit) {
        // Cleanup replaced/removed Cloudinary assets
        if (Array.isArray(productToEdit.images)) {
          cleanupOrphanedCloudinaryAssets(productToEdit.images, cloudinaryImages).catch(() => {});
        }
        if (Array.isArray(productToEdit.videos)) {
          cleanupOrphanedCloudinaryAssets(productToEdit.videos, cloudinaryVideos).catch(() => {});
        }

        // Edit flow
        await updateProduct(productToEdit.id, {
          title: finalTitle,
          description,
          price: parsedPrice,
          category,
          location: compiledLocation,
          brand: finalBrand,
          condition: finalCondition,
          images: cloudinaryImages,
          imageUrls: cloudinaryImages,
          displayImage: cloudinaryImages[0] || cloudinaryVideoPoster || '',
          primaryPicture: cloudinaryImages[0] || cloudinaryVideoPoster || '',
          videoPoster: cloudinaryVideoPoster || (cloudinaryVideos[0] ? getCloudinaryVideoPoster(cloudinaryVideos[0]) : ''),
          videos: cloudinaryVideos,
          videoUrls: cloudinaryVideos,
          negotiable: finalNegotiable,
          isExchangeable: finalIsExchangeable,
          exchangePossible: finalIsExchangeable,
          sellerId: productToEdit.sellerId,
          sellerName: productToEdit.sellerName,
          sellerEmail: productToEdit.sellerEmail,
          sellerPhoto: productToEdit.sellerPhoto,
          sellerJoinDate: productToEdit.sellerJoinDate
        });

        showToast("Ad updated successfully!", "success");
        setSelectedProductId(productToEdit.id);
        setCurrentView('product-detail');
      } else {
        // Create flow
        const newProd = await createProduct({
          title: finalTitle,
          description,
          price: parsedPrice,
          category,
          location: compiledLocation,
          brand: finalBrand,
          condition: finalCondition,
          images: cloudinaryImages,
          imageUrls: cloudinaryImages,
          displayImage: cloudinaryImages[0] || cloudinaryVideoPoster || '',
          primaryPicture: cloudinaryImages[0] || cloudinaryVideoPoster || '',
          videoPoster: cloudinaryVideoPoster || (cloudinaryVideos[0] ? getCloudinaryVideoPoster(cloudinaryVideos[0]) : ''),
          videos: cloudinaryVideos,
          videoUrls: cloudinaryVideos,
          negotiable: finalNegotiable,
          isExchangeable: finalIsExchangeable,
          exchangePossible: finalIsExchangeable
        });

        showToast("Ad posted successfully!", "success");

        // Explicitly reset the form states
        setTitle('');
        setDescription('');
        setPrice('');
        setCategory('Phones');
        setServiceSubCategory('Photography and Video Services');
        setCustomServiceType('');
        setLocation('');
        setBrand('');
        setCondition('');
        setImages([]);
        setVideos([]);
        setVideoPreviewUrl('');
        setPendingVideoFile(null);
        setOversizedVideoFile(null);
        setMediaType('image');
        setAdRegion('Greater Accra');
        setAdCity('Accra');
        setAdNeighborhood('');
        setNegotiable(true);
        setIsExchangeable(false);

        if (newProd && newProd.id) {
          setSelectedProductId(newProd.id);
          if (postOption === 'boost') {
            setCreatedProductForBoost(newProd);
            return; // Prevent immediate onClose so they can complete boost checkout
          } else {
            setCurrentView('product-detail');
          }
        } else {
          setCurrentView('my-dashboard');
        }
      }

      onClose();
    } catch (e: any) {
      let errStr = e?.message || String(e);
      let isPermissionDenied = false;
      if (errStr.trim().startsWith('{') && errStr.trim().endsWith('}')) {
        try {
          const parsed = JSON.parse(errStr);
          if (parsed.error) {
            errStr = parsed.error;
            if (errStr.includes('permission-denied') || errStr.toLowerCase().includes('permission') || errStr.toLowerCase().includes('insufficient')) {
              isPermissionDenied = true;
            }
          }
        } catch {
          // ignore
        }
      } else if (errStr && typeof errStr === 'string' && (errStr.includes('permission-denied') || errStr.toLowerCase().includes('permission') || errStr.toLowerCase().includes('insufficient'))) {
        isPermissionDenied = true;
      }

      if (errStr && typeof errStr === 'string') {
        if (typeof errStr.startsWith === 'function' && errStr.startsWith('FirebaseError: ')) {
          errStr = errStr.replace('FirebaseError: ', '');
        }
        if (typeof errStr.includes === 'function' && errStr.includes('[code=permission-denied]:')) {
          const codeIdx = errStr.indexOf('[code=permission-denied]:');
          if (codeIdx !== -1) {
            errStr = errStr.substring(codeIdx + '[code=permission-denied]:'.length).trim();
          }
        }
      }

      const friendlyErr = toUserFriendlyError(errStr);
      let finalMsg = friendlyErr.startsWith('Submission failed') ? friendlyErr : `Submission failed: ${friendlyErr}`;
      const lowerErr = friendlyErr.toLowerCase();
      const retryMatch = String(errStr).match(/try again in\s+(\d+)/i);
      if (retryMatch) {
        setRateLimitWaitSeconds(Number(retryMatch[1]));
      } else {
        setRateLimitWaitSeconds(null);
      }
      if (isPermissionDenied || lowerErr.includes('temporarily unavailable') || lowerErr.includes('permission')) {
        finalMsg += ' (Your session might have expired. Please try logging out and back in).';
      } else if (lowerErr.includes('connect') || lowerErr.includes('internet') || lowerErr.includes('network')) {
        finalMsg += ' (Please check your internet connection and try again).';
      } else if (lowerErr.includes('size') || lowerErr.includes('large') || lowerErr.includes('payload') || lowerErr.includes('limit')) {
        finalMsg += ' (Try using smaller images or a more compressed video to fit our 50MB size limit).';
      }
      setErrorMsg(finalMsg);
      showToast(finalMsg, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 text-slate-900 font-sans">
      <div className="min-h-screen flex flex-col bg-slate-50">
        {/* Full-Page Sticky Header */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={handleCancelOrBack}
                className="p-2 -ml-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition flex items-center gap-1.5 font-bold text-sm cursor-pointer shrink-0"
                title="Back to Marketplace"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="hidden sm:inline">Back</span>
              </button>

              <div className="border-l border-slate-200 pl-3 flex-1 min-w-0">
                <h1 className="text-base sm:text-lg font-black text-slate-950 font-sans tracking-tight">
                  {productToEdit ? 'Edit Live Advertisement' : 'Post Free Ad on Tedbuy'}
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-500 font-medium hidden xs:block">
                  Reach thousands of verified buyers across Ghana
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Content body */}
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-32">
          {errorMsg && (
            <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-2xl text-xs sm:text-sm flex items-start gap-3 border border-red-200 shadow-2xs">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1 space-y-1">
                <span className="font-semibold">{errorMsg}</span>
                {rateLimitWaitSeconds !== null && rateLimitWaitSeconds > 0 && (
                  <div className="font-medium text-red-600">
                    You can try again in {rateLimitWaitSeconds} second{rateLimitWaitSeconds === 1 ? '' : 's'}.
                  </div>
                )}
              </div>
            </div>
          )}

          <form id="listing-creation-form" onSubmit={handleSubmit} className="space-y-6">
            {/* Category selection first, then conditionally Title */}
            <div className={`grid grid-cols-1 ${category !== 'Services' ? 'md:grid-cols-2' : ''} gap-4`}>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-800">Ad Category</label>
                <select
                  id="listing-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer font-bold"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>
                      {CATEGORY_ICONS[cat] ? `${CATEGORY_ICONS[cat]} ` : ''}{cat}
                    </option>
                  ))}
                </select>
              </div>

              {category !== 'Services' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-800">
                    {category === 'Jobs & Employment' ? 'Job Title' : 'Product Title'}
                  </label>
                  <input
                    type="text"
                    required
                    id="listing-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={category === 'Jobs & Employment' ? "e.g. Graphic Designer, Store Manager, Sales Executive" : "e.g. iPhone 14 Pro 128GB"}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Dynamic Brand & Condition / Services Details / Jobs & Employment */}
            {category === 'Services' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={serviceSubCategory !== 'Other' ? "col-span-1 md:col-span-2" : ""}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Service Type</label>
                  <select
                    id="listing-service-sub-category"
                    value={serviceSubCategory}
                    onChange={(e) => setServiceSubCategory(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none cursor-pointer"
                  >
                    <option value="Photography and Video Services">Photography and Video Services</option>
                    <option value="Computer or IT Services">Computer or IT Services</option>
                    <option value="Fashion Services">Fashion Services</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {serviceSubCategory === 'Other' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold animate-pulse text-emerald-600">Specify Service Specialty</label>
                    <input
                      type="text"
                      required
                      id="listing-custom-service-type"
                      value={customServiceType}
                      onChange={(e) => setCustomServiceType(e.target.value)}
                      placeholder="e.g. Catering, Plumbing, Cleaning"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none placeholder-slate-400"
                    />
                  </div>
                )}
              </div>
            ) : category === 'Jobs & Employment' ? null : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Brand / Manufacturer <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    id="listing-brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Apple, Nike, Samsung, Toyota (optional)"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none mb-2"
                  />
                  {/* Negotiable Checkbox Placed Exactly Under Brand */}
                  <label className="flex items-center gap-2.5 px-3 py-1.5 border border-slate-200 rounded-xl bg-slate-50/70 hover:bg-slate-100/80 cursor-pointer transition select-none">
                    <input
                      type="checkbox"
                      id="listing-negotiable"
                      checked={negotiable}
                      onChange={(e) => setNegotiable(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5 text-left">
                      <span className="text-xs font-bold text-slate-700 leading-none">Negotiable</span>
                      <span className="text-[10px] text-slate-400 font-normal">(Discuss price with buyers)</span>
                    </div>
                  </label>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Item Condition <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    {condition && (
                      <button
                        type="button"
                        onClick={() => setCondition('')}
                        className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    id="listing-condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="e.g. Brand New, Slightly Used (optional)"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none mb-2"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {['Brand New', 'Slightly Used', 'Refurbished', 'Used - Fair'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCondition(condition === preset ? '' : preset)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border transition font-medium ${
                          condition === preset
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Price & Location Selectors */}
            {category === 'Jobs & Employment' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-800">
                    Location (Region in Ghana)
                  </label>
                  <select
                    id="listing-region"
                    value={adRegion}
                    onChange={(e) => setAdRegion(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer font-medium"
                  >
                    {GHANA_REGIONS.map(reg => (
                      <option key={reg.name} value={reg.name}>{reg.name} Region</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 font-bold text-slate-800">City / Town</label>
                  <select
                    id="listing-city"
                    value={adCity}
                    onChange={(e) => setAdCity(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer"
                  >
                    {activeRegionObj?.cities.map(ct => (
                      <option key={ct} value={ct}>{ct}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Specific Office Area / Work Location <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    id="listing-neighborhood"
                    value={adNeighborhood}
                    onChange={(e) => setAdNeighborhood(e.target.value)}
                    placeholder="e.g. Airport Residential Area, Spintex Road, Remote, Osu"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {category !== 'Services' ? (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Price</label>
                        <input
                          type="text"
                          required
                          id="listing-price"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="eg.50"
                          className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                        />
                      </div>
                      <label className="flex items-center gap-2.5 px-3 py-2 border border-slate-200 rounded-xl bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition select-none">
                        <input
                          type="checkbox"
                          id="listing-exchangeable"
                          checked={isExchangeable}
                          onChange={(e) => setIsExchangeable(e.target.checked)}
                          className="w-4 h-4 text-emerald-650 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                        />
                        <div className="flex flex-col text-left">
                          <span className="text-[11px] font-bold text-slate-705 leading-none">Exchange Possible</span>
                          <span className="text-[8px] text-slate-400">Open to swapping / item trade</span>
                        </div>
                      </label>
                    </div>
                  ) : null}

                  <div className={category === 'Services' ? "col-span-1 md:col-span-2" : ""}>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Ghana Region</label>
                    <select
                      id="listing-region"
                      value={adRegion}
                      onChange={(e) => setAdRegion(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer"
                    >
                      {GHANA_REGIONS.map(reg => (
                        <option key={reg.name} value={reg.name}>{reg.name} Region</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Town</label>
                    <select
                      id="listing-city"
                      value={adCity}
                      onChange={(e) => setAdCity(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-slate-500 focus:outline-none cursor-pointer"
                    >
                      {activeRegionObj?.cities.map(ct => (
                        <option key={ct} value={ct}>{ct}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Specific Neighborhood (Optional)</label>
                    <input
                      type="text"
                      id="listing-neighborhood"
                      value={adNeighborhood}
                      onChange={(e) => setAdNeighborhood(e.target.value)}
                      placeholder="e.g. Asokwa, North Legon, West Legon"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <label className="block text-xs font-semibold text-slate-700 font-bold text-slate-800">
                  {category === 'Jobs & Employment' ? 'Detailed Description' : 'Detailed Description'}
                </label>
                <div className="flex items-center gap-2">
                  {description.trim().length > 0 && !isGeneratingDescription && (
                    <button
                      type="button"
                      onClick={() => {
                        setDescription('');
                        lastAiGeneratedTextRef.current = '';
                        setAiDescriptionError('');
                        setAiDescriptionWarning('');
                      }}
                      className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    disabled={!hasMinimumInfoForAi || isGeneratingDescription || isSubmitting}
                    title={!hasMinimumInfoForAi ? 'Add a little more information about your item for a better description.' : undefined}
                    className={`inline-flex items-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-xl border transition ${
                      !hasMinimumInfoForAi || isSubmitting
                        ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                        : isGeneratingDescription
                        ? 'bg-slate-900 border-slate-900 text-white cursor-wait'
                        : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800 cursor-pointer'
                    }`}
                  >
                    {isGeneratingDescription ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      description.trim().length > 0 ? 'Regenerate with AI' : 'Generate with AI'
                    )}
                  </button>
                </div>
              </div>
              <textarea
                ref={descriptionTextareaRef}
                required
                id="listing-description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.max(96, e.target.scrollHeight)}px`;
                }}
                placeholder={category === 'Jobs & Employment' ? "Describe job roles, responsibilities, required qualifications/experience, work schedule, compensation, and how candidates can apply..." : "Write item status, usage duration, and notes for buyers..."}
                rows={3}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none resize-none overflow-hidden transition-[height] duration-75 min-h-[96px]"
              />
              {aiDescriptionError ? (
                <p className="mt-1.5 text-[11px] text-rose-500 font-medium">{aiDescriptionError}</p>
              ) : aiDescriptionWarning ? (
                <p className="mt-1.5 text-[11px] text-amber-600 font-medium">⚠ {aiDescriptionWarning}</p>
              ) : null}
            </div>

            {/* Media Type Segmented Selection */}
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                  {category === 'Jobs & Employment' ? 'Job Flyer, Logo or Video (Optional)' : 'Ad Media Format'}
                </label>
                {category === 'Jobs & Employment' && (
                  <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    Optional
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => setMediaType('image')}
                  className={`py-3 px-4 rounded-2xl text-xs font-black flex items-center justify-center gap-2 border transition duration-200 cursor-pointer ${
                    mediaType === 'image'
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-705 hover:bg-slate-50'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>{category === 'Jobs & Employment' ? 'Image / Flyer' : 'Standard Image Ad'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMediaType('video')}
                  className={`py-3 px-4 rounded-2xl text-xs font-black flex items-center justify-center gap-2 border transition duration-200 cursor-pointer ${
                    mediaType === 'video'
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-705 hover:bg-slate-50'
                  }`}
                >
                  <Video className="w-4 h-4 animate-pulse text-emerald-500" />
                  <span>{category === 'Jobs & Employment' ? 'Video Intro' : 'Dynamic Video Ad'}</span>
                </button>
              </div>
            </div>

            {/* Product Images (Rendered only for image ads) */}
            {mediaType === 'image' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-bold text-slate-900">
                      {category === 'Jobs & Employment' ? 'Company Logo / Recruitment Flyer' : 'Product & Item Photos'}
                    </label>
                    <p className="text-xs text-slate-500">
                      {category === 'Jobs & Employment'
                        ? 'Upload up to 10 company logos, brand flyers, or office photos'
                        : 'Upload up to 10 photos. Clear, bright photos get sold 3x faster'}
                    </p>
                  </div>
                  {images.length > 0 && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {images.length}/10 uploaded
                    </span>
                  )}
                </div>

                {/* Modernized studio dropzone when 0 photos uploaded */}
                {images.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingImages(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingImages(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingImages(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleImageFiles(Array.from(e.dataTransfer.files));
                      }
                    }}
                    onClick={() => imageInputRef.current?.click()}
                    className={`relative rounded-3xl border transition-all duration-200 p-8 sm:p-12 text-center flex flex-col items-center justify-center cursor-pointer group select-none ${
                      isDraggingImages
                        ? 'border-slate-900 bg-slate-100/90 shadow-md scale-[1.005]'
                        : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/60 shadow-xs'
                    }`}
                  >
                    <input
                      ref={imageInputRef}
                      type="file"
                      multiple
                      accept=".webp, .jfif, .jpg, .jpeg, .png, .heic, .heif, .avif, image/jpeg, image/png, image/webp, image/heic, image/heif, image/avif"
                      onChange={handleImageUpload}
                      className="hidden"
                    />

                    {/* Camera icon badge in signature TedBuy dark slate */}
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-100 group-hover:bg-slate-900 text-slate-700 group-hover:text-white flex items-center justify-center mb-4 transition-all duration-200 group-hover:scale-105 shadow-2xs">
                      <Camera className="w-8 h-8 sm:w-10 sm:h-10 stroke-[1.8] transition-colors" />
                    </div>

                    <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-1 font-sans tracking-tight">
                      {category === 'Jobs & Employment' ? 'Upload company logo or flyer' : 'Upload item photos'}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500 max-w-sm sm:max-w-md mx-auto mb-5 leading-relaxed">
                      Drag &amp; drop photos here, or click to choose from your gallery or computer
                    </p>

                    {/* Modern Action Pill Button */}
                    <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-xs transition group-hover:shadow-md">
                      <Upload className="w-4 h-4" />
                      <span>Choose Photos</span>
                    </div>

                    {/* Specifications & Feature Pills */}
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-6 text-[11px] font-medium text-slate-500">
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">JPG, PNG, WEBP, HEIC</span>
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">Up to 10 photos</span>
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">Max 20MB per photo</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        {images.length === 10 ? 'Maximum 10 photos reached' : `You can add ${10 - images.length} more photo${10 - images.length === 1 ? '' : 's'}`}
                      </p>
                      <button
                        type="button"
                        onClick={() => setImages([])}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
                      >
                        Clear All Photos
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
                      {images.map((imgStr, idx) => (
                        <div
                          key={idx}
                          className={`relative aspect-square rounded-2xl bg-slate-100 border overflow-hidden group shadow-2xs transition-all ${
                            idx === 0 ? 'border-slate-900 ring-2 ring-slate-900/15' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <img
                            src={imgStr}
                            alt={`Product photo ${idx + 1}`}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />

                          {/* Cover badge on photo 0 */}
                          {idx === 0 ? (
                            <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-xs text-white text-[10px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                              <span>Cover</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => makePrimaryImage(idx)}
                              className="absolute top-2 left-2 bg-white/95 hover:bg-slate-900 hover:text-white backdrop-blur-xs text-slate-800 text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-sm cursor-pointer"
                              title="Set as Cover Photo"
                            >
                              Set Cover
                            </button>
                          )}

                          {/* Delete button */}
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute top-2 right-2 p-1.5 bg-slate-900/80 hover:bg-rose-600 text-white rounded-full transition-all opacity-90 hover:opacity-100 shadow-sm cursor-pointer"
                            title="Delete Photo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>

                          {/* Index badge */}
                          <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                            {idx + 1} of {images.length}
                          </div>
                        </div>
                      ))}

                      {/* Add More card if less than 10 */}
                      {images.length < 10 && (
                        <label className="aspect-square rounded-2xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group p-3 text-center shadow-xs">
                          <input
                            type="file"
                            multiple
                            accept=".webp, .jfif, .jpg, .jpeg, .png, .heic, .heif, .avif, image/jpeg, image/png, image/webp, image/heic, image/heif, image/avif"
                            onChange={handleImageUpload}
                            className="hidden"
                          />
                          <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-slate-900 text-slate-700 group-hover:text-white flex items-center justify-center mb-1.5 transition-colors shadow-2xs">
                            <Plus className="w-5 h-5 stroke-[2.2]" />
                          </div>
                          <span className="text-xs font-bold text-slate-800 group-hover:text-slate-900">Add More</span>
                          <span className="text-[10px] text-slate-400 font-medium">{10 - images.length} left</span>
                        </label>
                      )}
                    </div>

                    {/* Pro Tip banner */}
                    <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/70 text-xs text-amber-900">
                      <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold">Cover Photo:</strong> The first photo is your main ad cover shown across the marketplace and search results. Click &ldquo;Set Cover&rdquo; on any image to make it the primary display.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Product Videos (Rendered only for video ads) */}
            {mediaType === 'video' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-bold text-slate-900">
                      {category === 'Jobs & Employment' ? 'Job / Company Video (Optional)' : 'Product Video'}
                    </label>
                    <p className="text-xs text-slate-500">
                      Showcase your item with an immersive 15–30 second dynamic video
                    </p>
                  </div>
                  {videos.length > 0 && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      1/1 video uploaded
                    </span>
                  )}
                </div>

                {videos.length === 0 && !oversizedVideoFile ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingVideos(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingVideos(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingVideos(false);
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        processVideoFile(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => videoInputRef.current?.click()}
                    className={`relative rounded-3xl border transition-all duration-200 p-8 sm:p-12 text-center flex flex-col items-center justify-center cursor-pointer group select-none ${
                      isDraggingVideos
                        ? 'border-slate-900 bg-slate-100/90 shadow-md scale-[1.005]'
                        : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50/60 shadow-xs'
                    }`}
                  >
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="hidden"
                    />

                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-100 group-hover:bg-slate-900 text-slate-700 group-hover:text-white flex items-center justify-center mb-4 transition-all duration-200 group-hover:scale-105 shadow-2xs">
                      <Video className="w-8 h-8 sm:w-10 sm:h-10 stroke-[1.8] transition-colors" />
                    </div>

                    <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-1 font-sans tracking-tight">
                      {category === 'Jobs & Employment' ? 'Upload job or brand video' : 'Upload dynamic product video'}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500 max-w-sm sm:max-w-md mx-auto mb-5 leading-relaxed">
                      Showcase your product in action. Ads with real video demos receive up to 5x more buyer inquiries!
                    </p>

                    <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-xs transition group-hover:shadow-md">
                      <Video className="w-4 h-4" />
                      <span>Choose Video File</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 mt-6 text-[11px] font-medium text-slate-500">
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">MP4, WebM, MOV</span>
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">Max 1 video</span>
                      <span className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg">Max 18MB (Trimmer included)</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Video Previews */}
                    {videos.map((vidStr, idx) => (
                      <div 
                        key={idx} 
                        onClick={() => handleReeditVideo(vidStr)}
                        className="relative aspect-video sm:aspect-square rounded-2xl bg-slate-900 border border-slate-200 group overflow-hidden cursor-pointer hover:ring-2 hover:ring-slate-900 transition-all shadow-xs"
                        title="Click to Edit / Re-trim Video"
                      >
                        <video 
                          src={videoPreviewUrl || vidStr} 
                          className="w-full h-full object-cover pointer-events-none" 
                          autoPlay 
                          muted 
                          loop 
                          playsInline 
                          webkit-playsinline="true"
                          disablePictureInPicture
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeVideo(idx);
                          }}
                          className="absolute top-2 right-2 p-1.5 bg-slate-900/80 hover:bg-rose-600 text-white rounded-full transition-all opacity-95 hover:scale-105 z-20 shadow-sm"
                          title="Delete Video"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-1 z-10">
                          <Scissors className="w-5 h-5 text-white animate-bounce" />
                          <span className="text-[10px] text-white font-extrabold tracking-wider uppercase">Re-trim Video</span>
                        </div>
                        <div className="absolute bottom-2 left-2 bg-slate-900/90 backdrop-blur-xs text-white text-[10px] font-black px-2 py-1 rounded-lg z-10 flex items-center gap-1.5 shadow-sm">
                          <Scissors className="w-3 h-3" />
                          <span>Edit Video</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Video Edit/Compressor Prompt Card — styled in Tedbuy's signature dark aesthetic, edge-to-edge on mobile for maximum editing workspace */}
                {oversizedVideoFile && (
                  <div className="-mx-4 sm:mx-0 bg-slate-900 border-y sm:border sm:border-slate-800 text-white rounded-none sm:rounded-2xl p-4 sm:p-5 space-y-4 mt-2 shadow-2xl animate-fadeIn">
                    {isCompressing ? (
                      /* Clean, simplified encoding progress */
                      <div className="space-y-3 py-1 px-1 sm:px-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                            <h4 className="text-xs sm:text-sm font-bold text-white">
                              Encoding, please wait...
                            </h4>
                          </div>
                          <span className="font-mono text-emerald-400 font-bold text-xs sm:text-sm">
                            {compressionProgress ?? 0}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700/60">
                          <div 
                            className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${compressionProgress ?? 0}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Optimizing video for high quality and fast playback...
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-3 px-1 sm:px-0">
                          <Scissors className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <h4 className="text-xs sm:text-sm font-bold text-white leading-snug">
                              Trim Your Video
                            </h4>
                            <p className="text-[11px] sm:text-xs text-slate-300">
                              Adjust the clip duration or click <strong className="text-emerald-400">Next</strong> below.
                            </p>
                          </div>
                        </div>

                        {/* Interactive Video Snippet Editor Console */}
                        {oversizedVideoUrl && (
                          <div className="w-full bg-slate-950 text-white rounded-xl sm:rounded-2xl p-3 sm:p-4 space-y-3 shadow-inner border border-slate-800">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                              <div className="flex items-center gap-1.5">
                                <Scissors className="w-4 h-4 text-emerald-400" />
                                <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-slate-200">Video Snippet Trimmer</span>
                              </div>
                              <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
                                Max 30s Limit
                              </span>
                            </div>

                            {/* Player Preview */}
                            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center">
                              <video
                                id="oversized-video-player"
                                src={oversizedVideoUrl}
                                controls
                                playsInline
                                webkit-playsinline="true"
                                preload="metadata"
                                disablePictureInPicture
                                controlsList="nodownload nofullscreen noremoteplayback"
                                className="w-full h-full object-contain"
                                onLoadedMetadata={(e) => {
                                  const dur = e.currentTarget.duration;
                                  if (!isNaN(dur) && dur > 0) {
                                    setVideoDuration(dur);
                                    setTrimEnd(Math.min(30, dur));
                                  }
                                }}
                                onDurationChange={(e) => {
                                  const dur = e.currentTarget.duration;
                                  if (!isNaN(dur) && dur > 0 && videoDuration === 0) {
                                    setVideoDuration(dur);
                                    setTrimEnd(Math.min(30, dur));
                                  }
                                }}
                              />
                            </div>

                            {/* Range Selectors */}
                            <div className="space-y-3 pt-1">
                              <div>
                                <div className="flex justify-between text-[11px] mb-1.5 text-slate-300 font-mono">
                                  <span className="font-semibold text-slate-400">Start Time:</span>
                                  <span className="font-mono text-emerald-400 font-bold">{trimStart.toFixed(1)}s</span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max={videoDuration || 30}
                                  step="0.1"
                                  value={trimStart}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setTrimStart(val);
                                    if (trimEnd < val) {
                                      setTrimEnd(Math.min(videoDuration || 30, val + 5));
                                    } else if (trimEnd - val > 30) {
                                      setTrimEnd(val + 30);
                                    }
                                    const playerCurrent = document.getElementById('oversized-video-player') as HTMLVideoElement;
                                    if (playerCurrent) {
                                      playerCurrent.currentTime = val;
                                    }
                                  }}
                                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>

                              <div>
                                <div className="flex justify-between text-[11px] mb-1.5 text-slate-300 font-mono">
                                  <span className="font-semibold text-slate-400">End Time:</span>
                                  <span className="font-mono text-emerald-400 font-bold">{trimEnd.toFixed(1)}s</span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max={videoDuration || 30}
                                  step="0.1"
                                  value={trimEnd}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (val < trimStart) {
                                      setTrimStart(Math.max(0, val - 5));
                                      setTrimEnd(val);
                                    } else if (val - trimStart > 30) {
                                      setTrimStart(val - 30);
                                      setTrimEnd(val);
                                    } else {
                                      setTrimEnd(val);
                                    }
                                    const playerCurrent = document.getElementById('oversized-video-player') as HTMLVideoElement;
                                    if (playerCurrent) {
                                      playerCurrent.currentTime = val;
                                    }
                                  }}
                                  className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>

                              {/* Interval Information */}
                              <div className="flex items-center justify-between text-xs bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 font-sans">
                                <span className="text-slate-400 font-medium">Selected Duration:</span>
                                <span className="text-emerald-400 font-black font-mono text-xs">
                                  {(trimEnd - trimStart).toFixed(1)} seconds
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 px-1 sm:px-0">
                          <span className="text-[11px] text-slate-300">
                            Click <strong className="text-emerald-400 font-bold">Next</strong> below to proceed.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setOversizedVideoFile(null);
                              setErrorMsg('');
                            }}
                            className="px-3 py-1.5 border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition cursor-pointer active:scale-95 flex items-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" />
                            Cancel Video
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-slate-400 mt-2">
                  <strong className="font-semibold text-slate-500">Tip</strong>: Click &ldquo;Add Video&rdquo; to upload a video guide (Max 1 video, Max 18MB) showing proof of functionality or live product demo.
                </p>
              </div>
            )}

            {/* Posting Option Selection */}
            {!productToEdit && (
              <div className="bg-slate-50 border border-slate-250/50 rounded-2xl p-4 mt-4">
                <label className={`p-3.5 border rounded-2xl flex flex-col gap-1 cursor-pointer transition-all ${
                  postOption === 'boost'
                    ? 'border-amber-400 bg-amber-50/20 ring-2 ring-amber-300/30 shadow-3xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
                      Boost Listing
                    </span>
                    <input
                      type="checkbox"
                      checked={postOption === 'boost'}
                      onChange={(e) => setPostOption(e.target.checked ? 'boost' : 'normal')}
                      className="accent-amber-500 cursor-pointer h-4 w-4"
                    />
                  </div>
                  <span className="text-[10px] text-amber-850 font-sans mt-0.5">Place your ad at the absolute top of the feed</span>
                </label>
              </div>
            )}

            {/* Form actions */}
            <div className="border border-slate-200/90 pt-5 pb-5 px-6 flex items-center justify-between gap-4 bg-white rounded-2xl shadow-xs">
              <button
                type="button"
                onClick={handleCancelOrBack}
                className="px-5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="listing-submit-btn"
                disabled={isSubmitting || isCompressing}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition duration-200 flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isCompressing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Encoding, please wait... ({compressionProgress ?? 0}%)</span>
                  </>
                ) : isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : oversizedVideoFile ? (
                  <>
                    <span>Next</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : productToEdit ? (
                  'Save Changes'
                ) : category === 'Jobs & Employment' ? (
                  'Post Job Vacancy'
                ) : (
                  'Post Ad Now'
                )}
              </button>
            </div>
          </form>
        </main>
      </div>

      {/* Boost modal triggered right after creation if selected */}
      <BoostModal
        isOpen={createdProductForBoost !== null}
        onClose={() => {
          setCreatedProductForBoost(null);
          setCurrentView('product-detail');
          onClose();
        }}
        product={createdProductForBoost}
        onSuccess={() => {
          setCreatedProductForBoost(null);
          setCurrentView('product-detail');
          onClose();
        }}
      />
    </div>
  );
};
