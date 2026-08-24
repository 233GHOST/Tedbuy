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
    const docs = data.filter(item => item && item.document).map(item => {
      const doc = item.document;
      const fields = doc.fields || {};
      const parts = doc.name.split("/");
      const id = parts[parts.length - 1];
      
      const parseVal = (val) => {
        if (!val) return undefined;
        if ('stringValue' in val) return val.stringValue;
        if ('integerValue' in val) return parseInt(val.integerValue, 10);
        if ('doubleValue' in val) return parseFloat(val.doubleValue);
        if ('booleanValue' in val) return val.booleanValue;
        return undefined;
      };

      const title = fields.title?.stringValue || "";
      const isApproved = fields.isApproved ? parseVal(fields.isApproved) : true;
      const sellerId = fields.sellerId?.stringValue || "";
      const sellerName = fields.sellerName?.stringValue || "";
      const createdAt = fields.createdAt?.stringValue || "";
      const price = fields.price?.stringValue || "";

      return { id, title, isApproved, sellerId, sellerName, createdAt, price };
    });

    console.log(`Analyzed ${docs.length} products:`);
    
    // Group by sellerName
    const sellers = {};
    docs.forEach(d => {
      sellers[d.sellerName] = (sellers[d.sellerName] || 0) + 1;
    });
    console.log("\nProducts per Seller:", sellers);

    // Group by isApproved
    const approvals = {};
    docs.forEach(d => {
      approvals[d.isApproved] = (approvals[d.isApproved] || 0) + 1;
    });
    console.log("\nApproved status:", approvals);

    // Sort by createdAt desc and print first 10
    const sorted = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    console.log("\nNewest 5 Products:");
    sorted.slice(0, 5).forEach(d => {
      console.log(`- ${d.id} | ${d.createdAt} | ${d.title} | ${d.sellerName} | Approved: ${d.isApproved}`);
    });

    console.log("\nOldest 5 Products:");
    sorted.slice(-5).forEach(d => {
      console.log(`- ${d.id} | ${d.createdAt} | ${d.title} | ${d.sellerName} | Approved: ${d.isApproved}`);
    });

  } else {
    console.error("Firestore Error:", response.status, await response.text());
  }
}

main().catch(console.error);
