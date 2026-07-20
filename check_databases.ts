import { createClient } from "@supabase/supabase-js";
import fs from "fs";

async function main() {
  const sbUrl = process.env.SUPABASE_URL || "";
  const sbKey = process.env.SUPABASE_ANON_KEY || "";
  const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  const projectId = config.projectId;
  const apiKey = config.apiKey;

  console.log("Supabase URL:", sbUrl);
  console.log("Firestore Project ID:", projectId);

  // 1. Fetch from Supabase
  const supabase = createClient(sbUrl, sbKey);
  const { data: sbProducts, error: sbErr } = await supabase
    .from("products")
    .select("id, title, createdAt");
  
  if (sbErr) {
    console.error("Supabase Error:", sbErr);
    return;
  }
  console.log(`Supabase products count: ${sbProducts?.length}`);

  // 2. Fetch from Firestore REST API
  // Using standard Firestore REST documents list
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products?pageSize=500`;
  const response = await fetch(firestoreUrl);
  let fsProducts: any[] = [];
  if (response.ok) {
    const data = await response.json();
    const documents = data.documents || [];
    fsProducts = documents.map((doc: any) => {
      const parts = doc.name.split("/");
      const id = parts[parts.length - 1];
      const fields = doc.fields || {};
      const title = fields.title?.stringValue || "";
      const createdAt = fields.createdAt?.stringValue || "";
      return { id, title, createdAt };
    });
  } else {
    console.error("Firestore REST Error:", response.status, await response.text());
  }
  console.log(`Firestore products count: ${fsProducts.length}`);

  // Find missing in Supabase but present in Firestore
  const sbIds = new Set(sbProducts?.map(p => p.id) || []);
  const fsIds = new Set(fsProducts.map(p => p.id));

  const missingInSb = fsProducts.filter(p => !sbIds.has(p.id));
  console.log(`\nMissing in Supabase but present in Firestore (${missingInSb.length}):`);
  missingInSb.forEach(p => {
    console.log(`- ID: ${p.id} | Title: "${p.title}" | CreatedAt: ${p.createdAt}`);
  });

  const missingInFs = (sbProducts || []).filter(p => !fsIds.has(p.id));
  console.log(`\nMissing in Firestore but present in Supabase (${missingInFs.length}):`);
  missingInFs.forEach(p => {
    console.log(`- ID: ${p.id} | Title: "${p.title}" | CreatedAt: ${p.createdAt}`);
  });
}

main().catch(console.error);
