import { Product } from '../types';
import { supabase, isSupabaseActive } from '../dbAdapter';
import { uploadToCloudinary } from './cloudinary';

// In-memory set to prevent duplicate concurrent migration triggers for the same product ID
const activeMigrations = new Set<string>();

export interface MigrationResult {
  success: boolean;
  productId: string;
  supabaseProduct?: Product;
  imagesUploadedCount: number;
  videosUploadedCount: number;
  error?: string;
}

/**
 * Checks if a product needs Cloudinary & Supabase migration
 */
export function isProductMigrated(product: Product): boolean {
  if (!product) return true;
  if ((product as any).migratedToSupabase === true) return true;

  // Check if images or videos contain base64 strings or local proxy URLs
  const hasBase64Images = Array.isArray(product.images) && product.images.some(
    img => typeof img === 'string' && (img.startsWith('data:') || img.startsWith('/api/products/'))
  );
  const hasBase64Videos = Array.isArray(product.videos) && product.videos.some(
    vid => typeof vid === 'string' && (vid.startsWith('data:') || vid.startsWith('/api/products/'))
  );

  return !hasBase64Images && !hasBase64Videos;
}

/**
 * Automatically migrates a single legacy product to Cloudinary + Supabase
 * Leaves the original source untouched for ZERO DATA LOSS safety.
 */
export async function migrateProductToSupabase(
  product: Product,
  onProgress?: (status: string) => void
): Promise<MigrationResult> {
  if (!product || !product.id) {
    return { success: false, productId: '', imagesUploadedCount: 0, videosUploadedCount: 0, error: 'Invalid product data' };
  }

  // Deduplicate concurrent migration requests
  if (activeMigrations.has(product.id)) {
    console.log(`[Migration] Product ${product.id} is already migrating...`);
    return { success: true, productId: product.id, imagesUploadedCount: 0, videosUploadedCount: 0 };
  }

  activeMigrations.add(product.id);

  try {
    if (onProgress) onProgress(`Starting migration for listing ${product.id}...`);

    // 1. Process images (Upload Base64 to Cloudinary)
    const migratedImages: string[] = [];
    let imagesUploadedCount = 0;

    if (Array.isArray(product.images)) {
      for (let i = 0; i < product.images.length; i++) {
        const img = product.images[i];
        if (typeof img === 'string' && (img.startsWith('data:') || img.startsWith('/api/products/'))) {
          try {
            if (onProgress) onProgress(`Uploading image ${i + 1}/${product.images.length} to Cloudinary...`);
            
            // If it's a proxy URL, try loading base64 from server or fetch
            let base64ToUpload = img;
            if (img.startsWith('/api/products/')) {
              const res = await fetch(img);
              if (res.ok) {
                const blob = await res.blob();
                const uploadRes = await uploadToCloudinary(blob, 'image');
                migratedImages.push(uploadRes.secure_url);
                imagesUploadedCount++;
                continue;
              }
            }

            const uploadRes = await uploadToCloudinary(base64ToUpload, 'image');
            migratedImages.push(uploadRes.secure_url);
            imagesUploadedCount++;
          } catch (err) {
            console.warn(`[Migration] Failed to upload image ${i} for product ${product.id}:`, err);
            // Fallback to original image if Cloudinary fails, or place holder
            migratedImages.push(img);
          }
        } else if (img && typeof img === 'string') {
          migratedImages.push(img);
        }
      }
    }

    // 2. Process videos (Upload Base64 to Cloudinary)
    const migratedVideos: string[] = [];
    let videosUploadedCount = 0;

    if (Array.isArray(product.videos)) {
      for (let i = 0; i < product.videos.length; i++) {
        const vid = product.videos[i];
        if (typeof vid === 'string' && vid.startsWith('data:')) {
          try {
            if (onProgress) onProgress(`Uploading video ${i + 1}/${product.videos.length} to Cloudinary...`);
            const uploadRes = await uploadToCloudinary(vid, 'video');
            migratedVideos.push(uploadRes.secure_url);
            videosUploadedCount++;
          } catch (err) {
            console.warn(`[Migration] Failed to upload video ${i} for product ${product.id}:`, err);
            migratedVideos.push(vid);
          }
        } else if (vid && typeof vid === 'string') {
          migratedVideos.push(vid);
        }
      }
    }

    // 3. Construct updated product record with Cloudinary URLs and migrated status
    const migratedProduct: any = {
      ...product,
      images: migratedImages,
      videos: migratedVideos,
      // Metadata
      thumbnailUrl: migratedImages[0] || '',
      videoPosterUrl: migratedVideos[0] ? migratedVideos[0].replace(/\.[a-zA-Z0-9]+$/, '.jpg') : undefined,
      migratedToSupabase: true
    };

    // 4. Save directly into Supabase PostgreSQL table
    if (isSupabaseActive && supabase) {
      if (onProgress) onProgress(`Persisting listing ${product.id} into Supabase...`);
      
      const payload: any = {
        id: migratedProduct.id,
        title: migratedProduct.title || '',
        description: migratedProduct.description || '',
        price: String(migratedProduct.price || 'Negotiable'),
        category: migratedProduct.category || '',
        location: migratedProduct.location || '',
        images: migratedImages,
        videos: migratedVideos,
        brand: migratedProduct.brand || null,
        condition: migratedProduct.condition || null,
        negotiable: migratedProduct.negotiable !== false,
        sellerId: migratedProduct.sellerId || null,
        sellerName: migratedProduct.sellerName || null,
        createdAt: migratedProduct.createdAt || new Date().toISOString(),
        viewsCount: Number(migratedProduct.viewsCount) || 0,
        likesCount: Number(migratedProduct.likesCount) || 0,
        likedUserIds: migratedProduct.likedUserIds || [],
        boostStatus: migratedProduct.boostStatus === true,
        boostPlan: migratedProduct.boostPlan || null,
        boostStartDate: migratedProduct.boostStartDate || null,
        boostEndDate: migratedProduct.boostEndDate || null,
        boostPriority: Number(migratedProduct.boostPriority) || 0,
        priorityScore: Number(migratedProduct.priorityScore) || 0,
        boostPriorityLevel: Number(migratedProduct.boostPriorityLevel) || 0,
        boostPackagePrice: Number(migratedProduct.boostPackagePrice) || 0,
        remainingBoostTime: Number(migratedProduct.remainingBoostTime) || 0,
        boostAmount: Number(migratedProduct.boostAmount) || 0,
        lastBoostedAt: migratedProduct.lastBoostedAt || null,
        lastBoostPurchase: migratedProduct.lastBoostPurchase || null,
        paymentStatus: migratedProduct.paymentStatus || null,
        paymentReference: migratedProduct.paymentReference || null,
        boostHistory: JSON.stringify(migratedProduct.boostHistory || []),
        visitCount: Number(migratedProduct.visitCount) || 0,
        isApproved: migratedProduct.isApproved !== false
      };

      const { error: upsertError } = await supabase
        .from('products')
        .upsert(payload);

      if (upsertError) {
        throw new Error(`Supabase insert failed: ${upsertError.message}`);
      }

      // 5. Verify insertion succeeded by reading back row
      const { data: verified, error: verifyError } = await supabase
        .from('products')
        .select('id, images')
        .eq('id', product.id)
        .maybeSingle();

      if (verifyError || !verified) {
        throw new Error(`Verification failed after Supabase insertion for ${product.id}`);
      }
    }

    console.log(`[Migration Success] Product ${product.id} successfully migrated to Cloudinary + Supabase! Images: ${imagesUploadedCount}, Videos: ${videosUploadedCount}`);
    if (onProgress) onProgress(`Migration completed for listing ${product.id}!`);

    return {
      success: true,
      productId: product.id,
      supabaseProduct: migratedProduct,
      imagesUploadedCount,
      videosUploadedCount
    };
  } catch (err: any) {
    console.error(`[Migration Error] Product ${product.id} migration failed (legacy record remains untouched):`, err);
    return {
      success: false,
      productId: product.id,
      imagesUploadedCount: 0,
      videosUploadedCount: 0,
      error: err?.message || String(err)
    };
  } finally {
    activeMigrations.delete(product.id);
  }
}
