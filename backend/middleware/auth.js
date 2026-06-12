import { supabase } from "../../config/supabase.js";
import jwt from "jsonwebtoken";
import { oauthClient } from "../../config/googleOath.js";
import express from "express";
const router = express.Router();


export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = data.user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

