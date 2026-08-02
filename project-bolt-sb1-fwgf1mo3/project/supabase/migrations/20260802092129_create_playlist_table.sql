/*
# Create playlist table for music player

1. New Tables
- `playlist`
  - `id` (uuid, primary key)
  - `title` (text, not null) — song title
  - `url` (text, not null) — link to the song (YouTube, SoundCloud, direct audio URL, etc.)
  - `thumbnail_url` (text, nullable) — optional cover image URL
  - `sort_order` (integer, default 0) — ordering for the playlist
  - `created_at` (timestamptz, default now())

2. Security
- Enable RLS on `playlist`.
- This is a single-tenant shared playlist (no sign-in), so anon + authenticated
  can read, insert, update, and delete. The playlist is intentionally public.

3. Sample Data
- Inserts 6 royalty-free sample tracks (YouTube links) so the player has content on first load.
*/

CREATE TABLE IF NOT EXISTS playlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  thumbnail_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE playlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_playlist" ON playlist;
CREATE POLICY "anon_select_playlist" ON playlist FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_playlist" ON playlist;
CREATE POLICY "anon_insert_playlist" ON playlist FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_playlist" ON playlist;
CREATE POLICY "anon_update_playlist" ON playlist FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_playlist" ON playlist;
CREATE POLICY "anon_delete_playlist" ON playlist FOR DELETE
  TO anon, authenticated USING (true);

-- Seed sample tracks (only if table is empty)
INSERT INTO playlist (title, url, thumbnail_url, sort_order)
SELECT * FROM (VALUES
  ('Lofi Hip Hop Radio - Beats to Relax/Study to', 'https://www.youtube.com/watch?v=jfKfPfyJRdk', 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg', 1),
  ('Chillhop Yearmix 2023', 'https://www.youtube.com/watch?v=7NfUq4GgD1E', 'https://i.ytimg.com/vi/7NfUq4GgD1E/hqdefault.jpg', 2),
  ('Jazz for Sleep - Relaxing Night Jazz', 'https://www.youtube.com/watch?v=Dx5qFachd3A', 'https://i.ytimg.com/vi/Dx5qFachd3A/hqdefault.jpg', 3),
  ('Acoustic Guitar Morning Music', 'https://www.youtube.com/watch?v=2Vv-beeM3sk', 'https://i.ytimg.com/vi/2Vv-beeM3sk/hqdefault.jpg', 4),
  ('Deep Focus - Ambient Music for Work', 'https://www.youtube.com/watch?v=4xDzrQ9eJ9I', 'https://i.ytimg.com/vi/4xDzrQ9eJ9I/hqdefault.jpg', 5),
  ('K-Pop Remix Mix', 'https://www.youtube.com/watch?v=9bZkp7q19f0', 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg', 6)
) AS v(title, url, thumbnail_url, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM playlist);
