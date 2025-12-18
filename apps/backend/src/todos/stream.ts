import type { Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "../firebaseAdmin.js";
import { readSessionCookie } from "../session.js";

export async function todosStream(req: Request, res: Response) {
  const tokenParam = typeof req.query.token === "string" ? req.query.token : null;
  const sessionCookie = readSessionCookie(req);
  if (!tokenParam && !sessionCookie) {
    res.status(401).json({ error: "Missing session" });
    return;
  }

  try {
    const app = getFirebaseAdminApp();
    const auth = getAuth(app);

    const decoded = tokenParam
      ? await auth.verifyIdToken(tokenParam)
      : await auth.verifySessionCookie(sessionCookie as string, true);

    const origin = req.header("origin");
    if (origin === "https://collab-todo-66eb2.web.app" || origin === "https://collab-todo-66eb2.firebaseapp.com") {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const uid = decoded.uid;
    const db = getFirestore(app);
    const todos = db.collection("todos");

    let started = false;
    let debounce: NodeJS.Timeout | null = null;
    let keepAlive: NodeJS.Timeout | null = null;

    function send(event: string, data: unknown) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    function sendComment() {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }

    function scheduleEmit() {
      if (!started) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        send("todos_changed", { at: Date.now() });
      }, 250);
    }

    const unsubOwned = todos.where("ownerUid", "==", uid).onSnapshot(
      () => {
        if (!started) return;
        scheduleEmit();
      },
      () => {
        if (!started) return;
        scheduleEmit();
      }
    );

    const unsubAssigned = todos.where("assigneeUids", "array-contains", uid).onSnapshot(
      () => {
        if (!started) return;
        scheduleEmit();
      },
      () => {
        if (!started) return;
        scheduleEmit();
      }
    );

    started = true;
    send("ready", { ok: true });

    keepAlive = setInterval(() => {
      if (!started) return;
      sendComment();
    }, 25000);

    req.on("close", () => {
      started = false;
      if (debounce) clearTimeout(debounce);
      if (keepAlive) clearInterval(keepAlive);
      unsubOwned();
      unsubAssigned();
      res.end();
    });
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
