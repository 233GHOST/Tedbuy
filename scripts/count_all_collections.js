import fs from "fs";

async function main() {
  const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  const projectId = config.projectId;
  const apiKey = config.apiKey;

  const collections = [
    'users',
    'products',
    'chats',
    'messages',
    'reviews',
    'notifications',
    'storeNames',
    'boost_purchases',
    'boostPurchases'
  ];

  for (const collectionId of collections) {
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
              collectionId,
              allDescendants: false
            }
          ],
          limit: 10000
        }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const count = data.filter(item => item && item.document).length;
      console.log(`Collection "${collectionId}": ${count} documents`);
    } else {
      console.error(`Collection "${collectionId}" query failed:`, response.status);
    }
  }
}

main().catch(console.error);
