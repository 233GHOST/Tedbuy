async function test() {
  const projectId = "tedbuy-fb79a";
  const apiKey = "AIzaSyDddmRJVV3ywN5AeLsT7iZ4E2K329StfVA";
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;

  console.log("Fetching from URL:", firestoreUrl);
  try {
    const res = await fetch(firestoreUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "products", allDescendants: false }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: 10
        }
      })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Raw Response snippet (first 1000 chars):", text.slice(0, 1000));
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

test();
