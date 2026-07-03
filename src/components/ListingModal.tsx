import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Category, Product, normalizeCategory } from '../types';
import { BoostModal } from './BoostModal';
import { X, Image, Upload, AlertCircle, Plus, Video, Scissors, Sparkles } from 'lucide-react';
import { GHANA_REGIONS } from '../regions';
import { compressImage } from '../utils/imageOptimizer';
import { validateImageFile } from '../utils/fileValidation';
import { toUserFriendlyError } from '../utils/authErrorHelper';

interface ListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit?: Product | null;
}

const CATEGORIES: Category[] = [
  'Phones',
  'Laptops',
  'Fashion',
  'Home Appliances',
  'Vehicles',
  'Beauty and Care',
  'Games',
  'Electronics',
  'Services',
  'Other'
];

export const ListingModal: React.FC<ListingModalProps> = ({ isOpen, onClose, productToEdit }) => {
  const { createProduct, updateProduct, currentUser, setCurrentView, showToast, setSelectedProductId } = useApp();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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
  const [trimEnd, setTrimEnd] = useState<number>(10);
  const [compressionProgress, setCompressionProgress] = useState<number | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [negotiable, setNegotiable] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postOption, setPostOption] = useState<'normal' | 'boost'>('normal');
  const [createdProductForBoost, setCreatedProductForBoost] = useState<Product | null>(null);

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
  useEffect(() => {
    if (productToEdit) {
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
      setImages(productToEdit.images);
      const editVids = productToEdit.videos || [];
      setVideos(editVids);
      if (editVids.length > 0) {
        setVideoPreviewUrl(convertBase64ToBlobUrl(editVids[0]));
      } else {
        setVideoPreviewUrl('');
      }
      setBrand(productToEdit.brand || '');
      setCondition(productToEdit.condition || '');
      setNegotiable(productToEdit.negotiable !== false); // Default to true if undefined or true

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
      setOversizedVideoFile(null);
      setMediaType('image');
      setAdRegion('Greater Accra');
      setAdCity('Accra');
      setAdNeighborhood('');
      setNegotiable(true);
    }
    setErrorMsg('');
  }, [productToEdit, isOpen]);

  // Object URL, duration and trim range setup for oversized video
  useEffect(() => {
    if (oversizedVideoFile) {
      const url = URL.createObjectURL(oversizedVideoFile);
      setOversizedVideoUrl(url);
      
      const tempVideo = document.createElement('video');
      tempVideo.src = url;
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(tempVideo.duration || 10);
        setTrimStart(0);
        setTrimEnd(Math.min(10, tempVideo.duration || 10));
      };
      
      return () => {
        URL.revokeObjectURL(url);
        setOversizedVideoUrl('');
      };
    } else {
      setOversizedVideoUrl('');
      setVideoDuration(0);
      setTrimStart(0);
      setTrimEnd(10);
    }
  }, [oversizedVideoFile]);

  if (!isOpen) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const files = e.target.files;
    if (!files) return;

    const remainingSpots = 10 - images.length;
    if (files.length > remainingSpots) {
      setErrorMsg(`You can only upload up to 10 images. You have ${images.length} uploaded, meaning you can add ${remainingSpots} more.`);
      return;
    }

    (Array.from(files) as File[]).forEach(async file => {
      const validation = validateImageFile(file);
      if (!validation.isValid) {
        setErrorMsg(validation.error || 'Invalid image file.');
        return;
      }

      try {
        const compressed = await compressImage(file);
        setImages(prev => [...prev, compressed]);
      } catch (err) {
        console.error('Failed to compress image:', err);
        // Fallback to standard reader
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setImages(prev => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    });
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

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSpots = 1 - videos.length;
    if (files.length > remainingSpots) {
      setErrorMsg(`You can only upload 1 video. Please remove the existing video first.`);
      return;
    }

    const file = files[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setErrorMsg('Only video files (MP4, WEBM, MOV) are supported.');
      return;
    }
    
    // If the video is oversized (> 730KB), set the oversized file and prompt the user
    if (file.size > 730 * 1024) {
      setOversizedVideoFile(file);
      setErrorMsg(`"${file.name}" is too large (${(file.size / 1024).toFixed(0)}KB). The maximum allowed for database storage is 730KB. Use our built-in optimizer below to compress it to fit precisely.`);
      return;
    }

    // Preload video to validate its duration dynamically before converting/uploading
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    
    tempVideo.onloadedmetadata = () => {
      window.URL.revokeObjectURL(tempVideo.src);
      const duration = tempVideo.duration;
      
      if (isNaN(duration)) {
        setErrorMsg(`Could not read duration of "${file.name}". Please try a standard MP4 or WebM format.`);
        return;
      }
      
      if (duration > 10) {
        setErrorMsg(`"${file.name}" is too long (${duration.toFixed(1)}s). Videos must be 10 seconds or less to ensure fast loading times and stay within the database size limit. Please trim or record a shorter clip.`);
        return;
      }

      // If validation succeeds, convert to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setVideos([reader.result]);
          setOversizedVideoFile(null);
          // Set immediate local preview URL using the uploaded file's blob URL
          const blobUrl = URL.createObjectURL(file);
          setVideoPreviewUrl(blobUrl);
        }
      };
      reader.readAsDataURL(file);
    };

    tempVideo.onerror = () => {
      window.URL.revokeObjectURL(tempVideo.src);
      setErrorMsg(`Could not process format for "${file.name}". Please ensure it is a web-compatible format (e.g. MP4, WEBM or standard MOV).`);
    };

    tempVideo.src = URL.createObjectURL(file);
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
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', 'true');
      
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
      
      const mimeTypes = [
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp8',
        'video/webm;codecs=h264',
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
      // to squeeze the maximum possible visual output under the 730KB base64 capacity limit
      const totalToRecord = trimEnd - trimStart || 5;
      const targetBinaryBytes = 520 * 1024; // 520 KB raw binary (converts to ~700 KB base64, safe margin)
      const targetBits = targetBinaryBytes * 8;
      let calculatedBps = Math.floor(targetBits / totalToRecord);
      
      // Cap bitrate between 350,000 bps (already much cleaner than previous 150,000) and 1,200,000 bps
      if (calculatedBps < 350000) calculatedBps = 350000;
      if (calculatedBps > 1200000) calculatedBps = 1200000;

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

  const removeVideo = (indexToRemove: number) => {
    setVideos(prev => prev.filter((_, idx) => idx !== indexToRemove));
    setVideoPreviewUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (category !== 'Services' && !title.trim()) {
      return setErrorMsg('Product title is required.');
    }
    if (title.length > 150) {
      return setErrorMsg('Product title must be 150 characters or less.');
    }
    if (description.length > 5000) {
      return setErrorMsg('Product description must be 5000 characters or less.');
    }
    
    const finalTitle = category === 'Services'
      ? (serviceSubCategory === 'Other' ? (customServiceType.trim() || 'Other Service') : serviceSubCategory)
      : title;

    let parsedPrice: string | number = "Inquire";
    if (category !== 'Services') {
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
    if (!description.trim()) return setErrorMsg('Please write a detailed description of the item.');
    
    if (mediaType === 'image' && images.length === 0) {
      return setErrorMsg('Please upload at least 1 image to describe your product (Max: 10).');
    }
    if (mediaType === 'video' && videos.length === 0) {
      return setErrorMsg('Please upload at least 1 video demonstrating your product ad (Max: 2).');
    }

    const finalImages = mediaType === 'image' ? images : [];
    const finalVideos = mediaType === 'video' ? videos : [];

    const finalBrand = category === 'Services'
      ? (serviceSubCategory === 'Other' ? (customServiceType.trim() || 'Other Service') : serviceSubCategory)
      : brand;
    const finalCondition = category === 'Services' ? 'Service Offered' : condition;

    // Verify raw size of final payload doesn't exceed 1.01MB (Firestore 1MB document limit is 1,048,576 bytes)
    const payloadForCheck = JSON.stringify({
      title: finalTitle,
      description,
      price: parsedPrice,
      category,
      location: compiledLocation,
      brand: finalBrand,
      condition: finalCondition,
      images: finalImages,
      videos: finalVideos,
      negotiable
    });
    const payloadBytes = payloadForCheck.length;
    if (payloadBytes > 1010000) {
      return setErrorMsg(`The total media size is too large (${(payloadBytes / 1024).toFixed(0)}KB). Our database has a strict 1MB size limit. Please remove some images or upload a smaller, highly-compressed video under 730KB.`);
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      if (productToEdit) {
        // Edit flow
        await updateProduct(productToEdit.id, {
          title: finalTitle,
          description,
          price: parsedPrice,
          category,
          location: compiledLocation,
          brand: finalBrand,
          condition: finalCondition,
          images: finalImages,
          videos: finalVideos,
          negotiable
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
          images: finalImages,
          videos: finalVideos,
          negotiable
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
        setOversizedVideoFile(null);
        setMediaType('image');
        setAdRegion('Greater Accra');
        setAdCity('Accra');
        setAdNeighborhood('');
        setNegotiable(true);

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
        if (errStr.startsWith('FirebaseError: ')) {
          errStr = errStr.replace('FirebaseError: ', '');
        }
        if (errStr.includes('[code=permission-denied]:')) {
          errStr = errStr.substring(errStr.indexOf('[code=permission-denied]:') + '[code=permission-denied]:'.length).trim();
        }
      }

      const friendlyErr = toUserFriendlyError(errStr);
      let finalMsg = `Submission failed: ${friendlyErr}`;
      if (isPermissionDenied || friendlyErr.toLowerCase().includes('temporarily unavailable') || friendlyErr.toLowerCase().includes('permission')) {
        finalMsg += ' (Your session might have expired. Please try logging out and back in, check that you are editing your own items, and ensure images are compressed under 730KB).';
      } else if (friendlyErr.toLowerCase().includes('connect') || friendlyErr.toLowerCase().includes('internet')) {
        finalMsg += ' (Please check your internet connection and try again).';
      } else {
        finalMsg += ' (Try using smaller images or a highly compressed video under 730KB to fit our database size limits).';
      }
      setErrorMsg(finalMsg);
      showToast(finalMsg, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-100 max-w-2xl w-full shadow-2xl relative flex flex-col max-h-[92vh] text-left">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl">
          <h2 className="text-lg font-bold text-slate-950 font-sans tracking-tight">
            {productToEdit ? 'Edit Live Advertisement' : 'Post Free Ad on Tedbuy'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-xl transition text-slate-500 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="bg-red-50 text-red-700 p-4 rounded-xl text-xs flex items-start gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form id="listing-creation-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Category selection first, then conditionally Product Title */}
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
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {category !== 'Services' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Product Title</label>
                  <input
                    type="text"
                    required
                    id="listing-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. iPhone 14 Pro 128GB"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Dynamic Brand & Condition / Services Details */}
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
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Brand / Manufacturer</label>
                  <input
                    type="text"
                    id="listing-brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Apple, Nike, Samsung, Toyota (optional)"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Item Condition</label>
                  <input
                    type="text"
                    id="listing-condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="e.g. Brand New, Good Condition (optional)"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Price & Location Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {category !== 'Services' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Price</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      id="listing-price"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="eg.50"
                      className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
                    />
                    <label className="flex items-center gap-2 px-3 border border-slate-200 rounded-xl bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition shrink-0 select-none">
                      <input
                        type="checkbox"
                        id="listing-negotiable"
                        checked={negotiable}
                        onChange={(e) => setNegotiable(e.target.checked)}
                        className="w-4 h-4 text-emerald-650 focus:ring-emerald-500 border-slate-300 rounded cursor-pointer"
                      />
                      <div className="flex flex-col text-left">
                        <span className="text-[11px] font-bold text-slate-705 leading-none">Negotiable</span>
                        <span className="text-[8px] text-slate-400">Discuss price</span>
                      </div>
                    </label>
                  </div>
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

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Detailed Description</label>
              <textarea
                required
                id="listing-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write item status, usage duration, and notes for buyers..."
                rows={4}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-500 focus:outline-none"
              />
            </div>

            {/* Media Type Segmented Selection */}
            <div className="pt-4 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-2.5">Ad Media Format</label>
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
                  <span>Standard Image Ad</span>
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
                  <span>Dynamic Video Ad</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                💡 Select **Dynamic Video Ad** to showcase your product or services with a fully immersive video feed displayed prominently on the Home screen!
              </p>
            </div>

            {/* Product Images (Rendered only for image ads) */}
            {mediaType === 'image' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-705">Product Images (1 to 10 images)</label>
                  <span className="text-[11px] text-slate-400 font-mono">{images.length}/10 files uploaded</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {/* Thumbnail Previews */}
                  {images.map((imgStr, idx) => (
                    <div key={idx} className="relative aspect-square rounded-xl bg-slate-50 border border-slate-200 group overflow-hidden">
                      <img src={imgStr} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-all opacity-90 hover:scale-105"
                        title="Delete Image"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <span className="absolute bottom-1 left-1 bg-slate-900/70 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                        {idx === 0 ? 'Primary' : `Ad #${idx + 1}`}
                      </span>
                    </div>
                  ))}

                  {/* Upload Trigger Square */}
                  {images.length < 10 && (
                    <label className="aspect-square border-2 border-dashed border-slate-250 hover:border-slate-400 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-100 transition-all group">
                      <input
                        type="file"
                        multiple
                        accept=".webp, .jfif, .jpg, .jpeg, .png, .heic, .heif, .avif, image/jpeg, image/png, image/webp, image/heic, image/heif, image/avif"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <Upload className="w-5 h-5 text-slate-400 group-hover:text-slate-800 group-hover:-translate-y-0.5 transition" />
                      <span className="text-[10px] text-slate-450 mt-1 font-semibold group-hover:text-slate-900">Add Photos</span>
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-2">
                  **Tip**: Click &ldquo;Add Photos&rdquo; to browse file directory (up to 10 images). High quality landscape JPEG, PNG, or WEBP photos work best to attract buyers.
                </p>
              </div>
            )}

            {/* Product Videos (Rendered only for video ads) */}
            {mediaType === 'video' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-705">Product Video (Max 1 video)</label>
                  <span className="text-[11px] text-slate-400 font-mono">{videos.length}/1 file uploaded</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {/* Video Previews */}
                  {videos.map((vidStr, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleReeditVideo(vidStr)}
                      className="relative aspect-square rounded-xl bg-slate-50 border border-slate-200 group overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all shadow-xs"
                      title="Click to Edit / Re-trim Video"
                    >
                      <video 
                        src={videoPreviewUrl || vidStr} 
                        className="w-full h-full object-cover pointer-events-none" 
                        autoPlay 
                        muted 
                        loop 
                        playsInline 
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeVideo(idx);
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-650 hover:bg-red-700 text-white rounded-full transition-all opacity-95 hover:scale-105 z-20 shadow-sm"
                        title="Delete Video"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-1 z-10">
                        <Scissors className="w-4 h-4 text-white animate-bounce" />
                        <span className="text-[9px] text-white font-extrabold tracking-wider uppercase">Re-trim Video</span>
                      </div>
                      <div className="absolute bottom-1.5 left-1.5 bg-slate-900/80 backdrop-blur-xs text-white text-[8px] font-black px-1.5 py-0.5 rounded-md z-10 flex items-center gap-1 shadow-sm">
                        <Scissors className="w-2.5 h-2.5" />
                        <span>Edit Video</span>
                      </div>
                    </div>
                  ))}

                  {/* Video Trigger Square */}
                  {videos.length < 1 && !oversizedVideoFile && (
                    <label className="aspect-square border-2 border-dashed border-slate-250 hover:border-slate-400 rounded-xl flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-100 transition-all group">
                      <input
                        type="file"
                        accept="video/*"
                        onChange={handleVideoUpload}
                        className="hidden"
                      />
                      <Video className="w-5 h-5 text-slate-400 group-hover:text-slate-800 group-hover:-translate-y-0.5 transition" />
                      <span className="text-[10px] text-slate-450 mt-1 font-semibold group-hover:text-slate-900">Add Video</span>
                    </label>
                  )}
                </div>

                {/* Oversized Video Compressor Prompt Card */}
                {oversizedVideoFile && (
                  <div className="bg-amber-50/70 border border-amber-250 rounded-2xl p-4.5 space-y-4 mt-2 animate-fadeIn">
                    <div className="flex gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-xs font-black text-amber-900 leading-snug font-sans">
                          Video File is Too Large ({Math.round(oversizedVideoFile.size / 1024)}KB)
                        </h4>
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                          Edit video to required size
                        </p>
                      </div>
                    </div>

                    {/* Interactive Video Snippet Editor Console */}
                    {!isCompressing && oversizedVideoUrl && (
                      <div className="bg-slate-900 text-white rounded-xl p-3.5 space-y-3 shadow-md border border-slate-800">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-1.5">
                            <Scissors className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                            <span className="text-[10px] font-black tracking-wider uppercase text-slate-200">Video Snippet Trimmer</span>
                          </div>
                          <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/30">
                            Max 10s Limit
                          </span>
                        </div>

                        {/* Player Preview */}
                        <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center">
                          <video
                            id="oversized-video-player"
                            src={oversizedVideoUrl}
                            controls
                            className="w-full h-full object-contain"
                          />
                        </div>

                        {/* Range Selectors */}
                        <div className="space-y-3 pt-1">
                          <div>
                            <div className="flex justify-between text-[10px] mb-1 text-slate-300 font-mono">
                              <span className="font-semibold text-slate-400">Start Time:</span>
                              <span className="font-mono text-emerald-400 font-bold">{trimStart.toFixed(1)}s</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={videoDuration || 10}
                              step="0.1"
                              value={trimStart}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setTrimStart(val);
                                // Ensure trimEnd is at least trimStart and at most trimStart + 10
                                if (trimEnd < val) {
                                  setTrimEnd(Math.min(videoDuration, val + 5));
                                } else if (trimEnd - val > 10) {
                                  setTrimEnd(val + 10);
                                }
                                // Seek player to preview start frame
                                const playerCurrent = document.getElementById('oversized-video-player') as HTMLVideoElement;
                                if (playerCurrent) {
                                  playerCurrent.currentTime = val;
                                }
                              }}
                              className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>

                          <div>
                            <div className="flex justify-between text-[10px] mb-1 text-slate-300 font-mono">
                              <span className="font-semibold text-slate-400">End Time:</span>
                              <span className="font-mono text-emerald-400 font-bold">{trimEnd.toFixed(1)}s</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={videoDuration || 10}
                              step="0.1"
                              value={trimEnd}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (val < trimStart) {
                                  setTrimStart(Math.max(0, val - 5));
                                  setTrimEnd(val);
                                } else if (val - trimStart > 10) {
                                  setTrimStart(val - 10);
                                  setTrimEnd(val);
                                } else {
                                  setTrimEnd(val);
                                }
                                // Seek player to preview end frame
                                const playerCurrent = document.getElementById('oversized-video-player') as HTMLVideoElement;
                                if (playerCurrent) {
                                  playerCurrent.currentTime = val;
                                }
                              }}
                              className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>

                          {/* Interval Information */}
                          <div className="flex items-center justify-between text-[10px] bg-slate-950/60 px-2.5 py-1.5 rounded border border-slate-850 font-sans">
                            <span className="text-slate-400 font-medium">Selected Duration:</span>
                            <span className="text-emerald-400 font-black font-mono">
                              {(trimEnd - trimStart).toFixed(1)} seconds
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {isCompressing ? (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex items-center justify-between text-xs font-bold text-amber-900 font-sans">
                          <span className="flex items-center gap-1.5">
                            <Video className="w-4 h-4 animate-spin text-amber-600" />
                            Trim-encoding & exporting clip...
                          </span>
                          <span className="font-mono">{compressionProgress ?? 0}%</span>
                        </div>
                        <div className="w-full bg-amber-200/60 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-amber-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${compressionProgress ?? 0}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-amber-600 italic font-mono">
                          Re-encoding to light efficiency. Do not close this modal...
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => compressVideoFile(oversizedVideoFile)}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-750 text-white text-xs font-black rounded-xl cursor-pointer shadow-sm flex items-center gap-1.5 transition"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOversizedVideoFile(null);
                            setErrorMsg('');
                          }}
                          className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-slate-400 mt-2">
                  **Tip**: Click &ldquo;Add Video&rdquo; to upload a video guide (Max 1 video, Max 730KB due to database size limitations) showing proof of functionality or live product demo.
                </p>
              </div>
            )}

            {/* Posting Option Selection */}
            {!productToEdit && (
              <div className="bg-slate-50 border border-slate-250/50 rounded-2xl p-4 space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className={`p-3.5 border rounded-2xl flex flex-col gap-1 cursor-pointer transition-all ${
                    postOption === 'normal'
                      ? 'border-slate-400 bg-white ring-2 ring-slate-100 shadow-3xs'
                      : 'border-slate-200 bg-white/50 hover:bg-white'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">Post Normally</span>
                      <input
                        type="radio"
                        name="postOption"
                        checked={postOption === 'normal'}
                        onChange={() => setPostOption('normal')}
                        className="accent-slate-900 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10px] text-slate-450 font-sans mt-0.5">Free standard listing placement</span>
                  </label>

                  <label className={`p-3.5 border rounded-2xl flex flex-col gap-1 cursor-pointer transition-all ${
                    postOption === 'boost'
                      ? 'border-amber-400 bg-amber-50/20 ring-2 ring-amber-300/30 shadow-3xs'
                      : 'border-slate-200 bg-white/50 hover:bg-white'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900 flex items-center gap-1">
                        Boost Listing
                      </span>
                      <input
                        type="radio"
                        name="postOption"
                        checked={postOption === 'boost'}
                        onChange={() => setPostOption('boost')}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[10px] text-amber-850 font-sans mt-0.5">Upgrade to top ad tier instantly</span>
                  </label>
                </div>
              </div>
            )}

            {/* Form actions */}
            <div className="border-t border-slate-100 pt-5 flex items-center justify-end gap-3 bg-slate-50 p-4 -mx-6 -mb-6 rounded-b-3xl">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="listing-submit-btn"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-sm transition duration-200 flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : productToEdit ? 'Save Changes' : 'Post Ad Now'}
              </button>
            </div>
          </form>
        </div>
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
