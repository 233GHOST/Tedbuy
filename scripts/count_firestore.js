import fs from "fs";

async function main() {
  const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  const projectId = config.projectId;
  const apiKey = config.apiKey;

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/products?pageSize=1000`;
  const response = await fetch(firestoreUrl);
  if (response.ok) {
    const data = await response.json();
    const documents = data.documents || [];
    console.log(`FOUND ${documents.length} PRODUCTS IN FIRESTORE DIRECTLY!`);
    
    // Print first 5 and last 5 IDs
    const docIds = documents.map(doc => {
      const parts = doc.name.split("/");
      return parts[parts.length - 1];
    });
    console.log("First 5 IDs:", docIds.slice(0, 5));
    console.log("Last 5 IDs:", docIds.slice(-5));
  } else {
    console.error("Firestore REST Error:", response.status, await response.text());
  }
}

main().catch(console.error);
