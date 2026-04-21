import dotenv  from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ path: ".env" });


const supabaseUrl = process.env.SUPABASE_URL || 'https://atrgubtlxitrechsitrs.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cmd1YnRseGl0cmVjaHNpdHJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTcyMDgzNywiZXhwIjoyMDkxMjk2ODM3fQ.n5yz0QMcBM85dJZdGyDqB7Ne8gBp_YPp35OtVpjOd0s';

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
// console.log("ENV:", process.env.SUPABASE_URL);