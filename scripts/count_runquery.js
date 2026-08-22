import fs from "fs";

async function main() {
  const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  const projectId = config.projectId;
  const apiKey = config.apiKey;

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const response = await fetch(firestoreUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [
          {
            collectionId: "products",
            allDescendants: false
          }
        ],
        limit: 5000
      }
    })
  });

  if (response.ok) {
    const data = await response.json();
    console.log(`FOUND ${data.length} DOCUMENTS IN FIRESTORE VIA runQuery!`);
    const docs = data.filter(item => item && item.document).map(item => {
      const parts = item.document.name.split("/");
      return parts[parts.length - 1];
    });
    console.log("Docs count:", docs.length);
    console.log("First 10 IDs:", docs.slice(0, 10));
  } else {
    console.error("Firestore Error:", response.status, await response.text());
  }
}

main().catch(console.error);
