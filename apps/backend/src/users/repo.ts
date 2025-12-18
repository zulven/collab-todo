import {
  FieldValue,
  getFirestore,
  type Timestamp,
  type UpdateData
} from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "../firebaseAdmin.js";

export type UserDoc = {
  uid: string;
  email: string | null;
  displayName: string | null;
  updatedAt: Timestamp;
};

export type UserSummary = {
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

function usersCollection() {
  const db = getFirestore(getFirebaseAdminApp());
  return db.collection("users");
}

export async function upsertUserProfile(input: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): Promise<UserSummary> {
  const users = usersCollection();
  const ref = users.doc(input.uid);

  const update: UpdateData<UserDoc> = {
    uid: input.uid,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp
  };

  await ref.set(update, { merge: true });
  const snap = await ref.get();
  return toSummary(snap.data() as UserDoc);
}

export async function listRecentUsers(limit: number): Promise<UserSummary[]> {
  const users = usersCollection();
  const snap = await users.orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => toSummary(d.data() as UserDoc));
}

export async function lookupUsersByUid(uids: string[]): Promise<UserSummary[]> {
  const db = getFirestore(getFirebaseAdminApp());
  const refs = uids.map((id: string) => db.collection("users").doc(id));
  const snaps = await db.getAll(...refs);

  return snaps
    .filter((s) => s.exists)
    .map((s) => toSummary(s.data() as UserDoc));
}
