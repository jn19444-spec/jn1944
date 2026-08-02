import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey);

export type PlaylistTrack = {
  id: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  sort_order: number;
  created_at: string;
};
