import fs from "fs";

async function main() {
  const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
  const projectId = config.projectId;
  const apiKey = config.apiKey;

  // Let's list collections at root
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const response = await fetch(url);
  if (response.ok) {
    const data = await response.json();
    console.log("Root Documents/Collections:", JSON.stringify(data, null, 2));
  } else {
    console.error("Error listing root:", response.status, await response.text());
  }
}

main().catch(console.error);
