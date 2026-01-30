import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dglxjgadawhixqlkpchx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnbHhqZ2FkYXdoaXhxbGtwY2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2OTQyNzYsImV4cCI6MjA4NTI3MDI3Nn0.RlCcIFu-3lnQvaQ1SPxVWYG-F5ecZ-Hj-hb2UumHo_c';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
