import { Router, type Request, type Response } from "express";
import {
  FieldValue,
  getFirestore,
  type Timestamp,
  type UpdateData
} from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "./firebaseAdmin.js";

type UserDoc = {
  uid: string;
  email: string | null;
  displayName: string | null;
  updatedAt: Timestamp;
};

type UserSummary = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

function toSummary(doc: UserDoc): UserSummary {
  return {
    uid: doc.uid,
    email: doc.email ?? null,
    displayName: doc.displayName ?? null
  };
}

export const usersRouter = Router();

usersRouter.post("/me", async (req: Request, res: Response) => {
  const uid = req.auth?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const db = getFirestore(getFirebaseAdminApp());
  const ref = db.collection("users").doc(uid);

  const update: UpdateData<UserDoc> = {
    uid,
    email: req.auth?.email ?? null,
    displayName: req.auth?.name ?? null,
    updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp
  };

  await ref.set(update, { merge: true });

  const snap = await ref.get();
  res.status(200).json({ user: toSummary(snap.data() as UserDoc) });
});

usersRouter.get("/", async (req: Request, res: Response) => {
  const uid = req.auth?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

  const db = getFirestore(getFirebaseAdminApp());

  const snap = await db
    .collection("users")
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();

  const users = snap.docs
    .map((d) => d.data() as UserDoc)
    .filter((u) => u.uid !== uid)
    .filter((u) => {
      if (!q) return true;
      const email = (u.email ?? "").toLowerCase();
      const name = (u.displayName ?? "").toLowerCase();
      return email.includes(q) || name.includes(q);
    })
    .slice(0, 10)
    .map(toSummary);

  res.status(200).json({ users });
});

usersRouter.post("/lookup", async (req: Request, res: Response) => {
  const uid = req.auth?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const uidsRaw = Array.isArray(req.body?.uids) ? req.body.uids : [];
  const uids = uidsRaw
    .filter((v: unknown) => typeof v === "string")
    .map((v: string) => v.trim())
    .filter((v: string) => v.length > 0)
    .slice(0, 50);

  if (uids.length === 0) {
    res.status(200).json({ users: [] });
    return;
  }

  const db = getFirestore(getFirebaseAdminApp());
  const refs = uids.map((id: string) => db.collection("users").doc(id));
  const snaps = await db.getAll(...refs);

  const users = snaps
    .filter((s) => s.exists)
    .map((s) => toSummary(s.data() as UserDoc));

  res.status(200).json({ users });
});
