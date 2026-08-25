import dotenv  from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: ".env" });


const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
// console.log("ENV:", process.env.SUPABASE_URL);