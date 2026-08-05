import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary if env vars are present
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.VITE_CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });
  console.log(`[Batch Migration] Cloudinary configured for cloud: ${cloudName}`);
} else {
  console.warn('[Batch Migration Warning] Cloudinary environment variables missing or incomplete.');
}

const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const sbKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = sbUrl && sbKey ? createClient(sbUrl, sbKey) : null;

async function runBatchMigration() {
  console.log('====================================================');
  console.log('TEDBUY AUTOMATIC PRODUCT STORAGE MIGRATION JOB');
  console.log('Zero Data Loss Strategy: Firestore -> Cloudinary + Supabase');
  console.log('====================================================');

  if (!supabase) {
    console.error('ERROR: Supabase configuration missing. Aborting batch migration.');
    process.exit(1);
  }

  // Fetch Firestore products via REST
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'tedbuy-fb79a';
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products?pageSize=1000`;

  try {
    console.log(`Fetching products from Firestore REST API (${firestoreUrl})...`);
    const response = await fetch(firestoreUrl);
    if (!response.ok) {
      throw new Error(`Firestore REST query failed with status: ${response.status}`);
    }

    const data = await response.json();
    const documents = data.documents || [];
    console.log(`Retrieved ${documents.length} products from Firestore.`);

    let totalProcessed = 0;
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const doc of documents) {
      totalProcessed++;
      const fields = doc.fields || {};
      const parts = (doc.name || '').split('/');
      const id = parts[parts.length - 1] || `prod_${Date.now()}`;

      // Check if already in Supabase
      const { data: existing } = await supabase
        .from('products')
        .select('id, images')
        .eq('id', id)
        .maybeSingle();

      const imagesVal = fields.images?.arrayValue?.values || [];
      const rawImages = imagesVal.map((v: any) => v.stringValue).filter(Boolean);
      const hasBase64 = rawImages.some((img: string) => img.startsWith('data:') || img.startsWith('/api/products/'));

      if (existing && !hasBase64) {
        console.log(`[Skipped ${totalProcessed}/${documents.length}] Product ${id} already in Supabase with Cloudinary media.`);
        totalSkipped++;
        continue;
      }

      console.log(`[Migrating ${totalProcessed}/${documents.length}] Processing product ID: ${id}...`);

      const uploadedImages: string[] = [];
      for (let i = 0; i < rawImages.length; i++) {
        const img = rawImages[i];
        if (img.startsWith('data:')) {
          try {
            const uploadRes = await cloudinary.uploader.upload(img, {
              folder: 'tedbuy/products',
              resource_type: 'image'
            });
            uploadedImages.push(uploadRes.secure_url);
            console.log(`  Uploaded image ${i + 1}/${rawImages.length} to Cloudinary: ${uploadRes.secure_url}`);
          } catch (uploadErr: any) {
            console.warn(`  Failed image upload ${i + 1} for ${id}:`, uploadErr?.message || uploadErr);
            uploadedImages.push(img);
          }
        } else {
          uploadedImages.push(img);
        }
      }

      const videosVal = fields.videos?.arrayValue?.values || [];
      const rawVideos = videosVal.map((v: any) => v.stringValue).filter(Boolean);

      const payload = {
        id,
        title: fields.title?.stringValue || 'Untitled Listing',
        description: fields.description?.stringValue || '',
        price: fields.price?.stringValue || 'Negotiable',
        category: fields.category?.stringValue || 'Other',
        location: fields.location?.stringValue || '',
        images: uploadedImages,
        videos: rawVideos,
        brand: fields.brand?.stringValue || null,
        condition: fields.condition?.stringValue || null,
        negotiable: fields.negotiable?.booleanValue !== false,
        sellerId: fields.sellerId?.stringValue || null,
        sellerName: fields.sellerName?.stringValue || null,
        createdAt: fields.createdAt?.stringValue || new Date().toISOString(),
        viewsCount: parseInt(fields.viewsCount?.integerValue || '0', 10),
        likesCount: parseInt(fields.likesCount?.integerValue || '0', 10)
      };

      const { error: insertErr } = await supabase.from('products').upsert(payload);
      if (insertErr) {
        console.error(`  Supabase insert error for ${id}:`, insertErr.message);
        totalFailed++;
      } else {
        console.log(`  Successfully saved ${id} to Supabase!`);
        totalMigrated++;
      }
    }

    // Global Database Cleanup: Ensure images & videos in Supabase are proper JSON arrays
    console.log('----------------------------------------------------');
    console.log('Running Supabase Database Cleanup & Validation Routine...');
    const { data: allProds } = await supabase.from('products').select('id, images, videos');
    if (allProds) {
      let cleanedCount = 0;
      for (const p of allProds) {
        let imgs = p.images;
        let vids = p.videos;

        while (typeof imgs === 'string') {
          try { imgs = JSON.parse(imgs); } catch (_) { break; }
        }
        while (typeof vids === 'string') {
          try { vids = JSON.parse(vids); } catch (_) { break; }
        }

        const finalImgs = Array.isArray(imgs) ? imgs.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : [];
        const finalVids = Array.isArray(vids) ? vids.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : [];

        // Update row to ensure clean native JSONB arrays
        await supabase.from('products').update({
          images: finalImgs,
          videos: finalVids
        }).eq('id', p.id);
        cleanedCount++;
      }
      console.log(`Cleaned and validated ${cleanedCount} products in Supabase.`);
    }

    console.log('====================================================');
    console.log(`MIGRATION SUMMARY STATS`);
    console.log(`Total Products Analyzed: ${totalProcessed}`);
    console.log(`Successfully Migrated:   ${totalMigrated}`);
    console.log(`Already Migrated/Skip:  ${totalSkipped}`);
    console.log(`Failed Migrations:       ${totalFailed}`);
    console.log('Zero Data Loss Guaranteed: Firestore copies preserved.');
    console.log('====================================================');
  } catch (err) {
    console.error('Fatal error during batch migration:', err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBatchMigration();
}

export { runBatchMigration };
