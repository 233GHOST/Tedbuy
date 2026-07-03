import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";
import fetch from "node-fetch";

// Ensure Firebase Admin is initialized only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)
    ),
  });
}

const db = admin.firestore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { reference, listingId, userId, boostPlan } = req.body;

    if (!reference || !listingId || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Verify payment with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = await paystackRes.json();

    if (!data.status || data.data.status !== "success") {
      return res.status(400).json({ error: "Payment not successful" });
    }

    // 2. Idempotency check (VERY IMPORTANT)
    const paymentRef = db.collection("payments").doc(reference);
    const existing = await paymentRef.get();

    if (existing.exists) {
      return res.status(200).json({ success: true, message: "Already processed" });
    }

    // 3. Activate boost
    const boostDurationMap: any = {
      "GH₵1": 3,
      "GH₵3": 7,
      "GH₵7": 14,
      "GH₵12": 30,
      "GH₵20": 90,
    };

    const days = boostDurationMap[boostPlan] || 0;

    const now = new Date();
    const endDate = new Date();
    endDate.setDate(now.getDate() + days);

    // 4. Run Firestore transaction
    await db.runTransaction(async (tx) => {
      const listingRef = db.collection("listings").doc(listingId);

      tx.update(listingRef, {
        boostStatus: true,
        boostStartDate: now,
        boostEndDate: endDate,
        lastBoostedAt: now,
        paymentReference: reference,
        boostPlan,
        boostPriority: days,
      });

      tx.set(paymentRef, {
        reference,
        listingId,
        userId,
        boostPlan,
        status: "completed",
        createdAt: now,
      });
    });

    return res.status(200).json({
      success: true,
      message: "Boost activated successfully",
    });

  } catch (error: any) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}
