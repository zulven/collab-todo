import type { Request, Response } from "express";
import { lookupUsers, searchUsers, upsertMe } from "./service.js";

function getUid(req: Request, res: Response): string | null {
  const uid = req.auth?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthenticated" });
    return null;
  }
  return uid;
}

export async function postMe(req: Request, res: Response) {
  const uid = getUid(req, res);
  if (!uid) return;

  const user = await upsertMe({
    uid,
    email: req.auth?.email ?? null,
    displayName: req.auth?.name ?? null
  });

  res.status(200).json({ user });
}

export async function getUsers(req: Request, res: Response) {
  const uid = getUid(req, res);
  if (!uid) return;

  const q = typeof req.query.q === "string" ? req.query.q : "";
  const users = await searchUsers({ uid, q });
  res.status(200).json({ users });
}

export async function postLookup(req: Request, res: Response) {
  const uid = getUid(req, res);
  if (!uid) return;

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

  const users = await lookupUsers({ uids });
  res.status(200).json({ users });
}
