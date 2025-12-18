import { lookupUsersByUid, listRecentUsers, upsertUserProfile, type UserSummary } from "./repo.js";

export async function upsertMe(input: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): Promise<UserSummary> {
  return upsertUserProfile({
    uid: input.uid,
    email: input.email,
    displayName: input.displayName
  });
}

export async function searchUsers(input: {
  uid: string;
  q: string;
}): Promise<UserSummary[]> {
  const q = input.q.trim().toLowerCase();
  const users = await listRecentUsers(50);

  return users
    .filter((u) => u.uid !== input.uid)
    .filter((u) => {
      if (!q) return true;
      const email = (u.email ?? "").toLowerCase();
      const name = (u.displayName ?? "").toLowerCase();
      return email.includes(q) || name.includes(q);
    })
    .slice(0, 10);
}

export async function lookupUsers(input: {
  uids: string[];
}): Promise<UserSummary[]> {
  return lookupUsersByUid(input.uids);
}
