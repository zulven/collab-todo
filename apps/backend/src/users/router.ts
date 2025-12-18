import { Router } from "express";
import { getUsers, postLookup, postMe } from "./controller.js";

export const usersRouter = Router();

usersRouter.post("/me", postMe);
usersRouter.get("/", getUsers);
usersRouter.post("/lookup", postLookup);
