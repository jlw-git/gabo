-- Gabo seed venues. Placeholder data; curate before the real demo.
-- Run this AFTER 0001_gabo_schema.sql has created the `venues` table.
-- Each venue is its own INSERT so partial pastes fail loudly (not silently).

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Umi Nagomi', 1.2756, 103.8443, '78 Tanjong Pagar Rd',
   array['japanese','omakase'], array['cozy','celebratory'], array[]::text[], 4, false,
   'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=800',
   'https://book.chope.co/booking?rid=umi-nagomi',
   '{"mon":[],"tue":[{"open":"1830","close":"2230"}],"wed":[{"open":"1830","close":"2230"}],"thu":[{"open":"1830","close":"2230"}],"fri":[{"open":"1830","close":"2300"}],"sat":[{"open":"1830","close":"2300"}],"sun":[{"open":"1830","close":"2200"}]}'::jsonb,
   'critic_pick', '{"source":"Michelin Guide 2025"}'::jsonb, 0.78, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Candela', 1.2802, 103.8419, '49 Keong Saik Rd',
   array['spanish','tapas'], array['adventurous','loud'], array[]::text[], 3, false,
   'https://images.unsplash.com/photo-1544025162-d76694265947?w=800',
   'https://book.chope.co/booking?rid=candela',
   '{"mon":[{"open":"1800","close":"2300"}],"tue":[{"open":"1800","close":"2300"}],"wed":[{"open":"1800","close":"2300"}],"thu":[{"open":"1800","close":"2300"}],"fri":[{"open":"1800","close":"0000"}],"sat":[{"open":"1800","close":"0000"}],"sun":[]}'::jsonb,
   'soft_launch', '{"opened":"2026-03-12"}'::jsonb, 0.85, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('The Pizza Stop', 1.3112, 103.7958, '27 Lorong Mambong, Holland Village',
   array['italian','pizza'], array['cozy','low_key','outdoor'], array[]::text[], 2, true,
   'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800',
   'https://book.chope.co/booking?rid=pizza-stop',
   '{"mon":[{"open":"1700","close":"2230"}],"tue":[{"open":"1700","close":"2230"}],"wed":[{"open":"1700","close":"2230"}],"thu":[{"open":"1700","close":"2230"}],"fri":[{"open":"1200","close":"2300"}],"sat":[{"open":"1200","close":"2300"}],"sun":[{"open":"1200","close":"2200"}]}'::jsonb,
   'none', null, 0.35, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Saffron & Clove', 1.3068, 103.8519, '48 Serangoon Rd',
   array['indian'], array['low_key','cozy'], array['vegetarian_friendly','vegan'], 2, false,
   'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=800',
   'https://book.chope.co/booking?rid=saffron-clove',
   '{"mon":[{"open":"1800","close":"2230"}],"tue":[{"open":"1800","close":"2230"}],"wed":[{"open":"1800","close":"2230"}],"thu":[{"open":"1800","close":"2230"}],"fri":[{"open":"1200","close":"2300"}],"sat":[{"open":"1200","close":"2300"}],"sun":[{"open":"1200","close":"2200"}]}'::jsonb,
   'none', null, 0.3, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Wok Hei Bar', 1.2854, 103.8326, '78 Yong Siak St, Tiong Bahru',
   array['chinese','zi_char'], array['adventurous','loud'], array[]::text[], 2, false,
   'https://images.unsplash.com/photo-1552611052-33e04de081de?w=800',
   'https://book.chope.co/booking?rid=wok-hei-bar',
   '{"mon":[{"open":"1800","close":"2230"}],"tue":[{"open":"1800","close":"2230"}],"wed":[{"open":"1800","close":"2230"}],"thu":[{"open":"1800","close":"2230"}],"fri":[{"open":"1800","close":"2330"}],"sat":[{"open":"1800","close":"2330"}],"sun":[{"open":"1800","close":"2200"}]}'::jsonb,
   'award_fresh', '{"award":"Worlds 50 Best Discovery 2026"}'::jsonb, 0.72, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Maison Papillon', 1.3048, 103.8318, '302 Orchard Rd',
   array['french'], array['cozy','celebratory','romantic'], array[]::text[], 3, false,
   'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800',
   'https://book.chope.co/booking?rid=maison-papillon',
   '{"mon":[{"open":"1800","close":"2230"}],"tue":[{"open":"1800","close":"2230"}],"wed":[{"open":"1800","close":"2230"}],"thu":[{"open":"1800","close":"2230"}],"fri":[{"open":"1800","close":"2300"}],"sat":[{"open":"1800","close":"2300"}],"sun":[]}'::jsonb,
   'none', null, 0.45, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Kebab Junction', 1.2996, 103.8558, '14 Bali Lane, Bugis',
   array['middle_eastern','turkish'], array['low_key','loud'], array['halal','vegetarian_friendly'], 2, false,
   'https://images.unsplash.com/photo-1625398407796-82650a8c9dd4?w=800',
   'https://book.chope.co/booking?rid=kebab-junction',
   '{"mon":[{"open":"1200","close":"2300"}],"tue":[{"open":"1200","close":"2300"}],"wed":[{"open":"1200","close":"2300"}],"thu":[{"open":"1200","close":"2300"}],"fri":[{"open":"1200","close":"0000"}],"sat":[{"open":"1200","close":"0000"}],"sun":[{"open":"1200","close":"2300"}]}'::jsonb,
   'none', null, 0.28, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Green Ember', 1.3053, 103.8089, 'Dempsey Hill',
   array['modern_european','vegetarian'], array['cozy','romantic'], array['vegetarian_friendly','vegan'], 3, false,
   'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800',
   'https://book.chope.co/booking?rid=green-ember',
   '{"mon":[],"tue":[{"open":"1800","close":"2230"}],"wed":[{"open":"1800","close":"2230"}],"thu":[{"open":"1800","close":"2230"}],"fri":[{"open":"1800","close":"2300"}],"sat":[{"open":"1200","close":"2300"}],"sun":[{"open":"1200","close":"2200"}]}'::jsonb,
   'soft_launch', '{"opened":"2026-04-01"}'::jsonb, 0.7, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Hanok', 1.3064, 103.8316, '181 Orchard Rd',
   array['korean','bbq'], array['adventurous','celebratory','loud'], array[]::text[], 3, false,
   'https://images.unsplash.com/photo-1632789395770-20e6f63be806?w=800',
   'https://book.chope.co/booking?rid=hanok',
   '{"mon":[{"open":"1700","close":"2300"}],"tue":[{"open":"1700","close":"2300"}],"wed":[{"open":"1700","close":"2300"}],"thu":[{"open":"1700","close":"2300"}],"fri":[{"open":"1700","close":"0000"}],"sat":[{"open":"1200","close":"0000"}],"sun":[{"open":"1200","close":"2300"}]}'::jsonb,
   'none', null, 0.52, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Coconut Club Reserve', 1.281, 103.8469, '28 Ann Siang Rd',
   array['malay','peranakan'], array['low_key','cozy'], array['halal'], 2, false,
   'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=800',
   'https://book.chope.co/booking?rid=coconut-club-reserve',
   '{"mon":[{"open":"1100","close":"2200"}],"tue":[{"open":"1100","close":"2200"}],"wed":[{"open":"1100","close":"2200"}],"thu":[{"open":"1100","close":"2200"}],"fri":[{"open":"1100","close":"2230"}],"sat":[{"open":"1100","close":"2230"}],"sun":[{"open":"1100","close":"2200"}]}'::jsonb,
   'critic_pick', '{"source":"Straits Times Food Picks 2026"}'::jsonb, 0.55, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Sunset Terrace', 1.2789, 103.8536, '1 Raffles Place Level 62',
   array['mediterranean'], array['celebratory','outdoor','romantic'], array[]::text[], 4, true,
   'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800',
   'https://book.chope.co/booking?rid=sunset-terrace',
   '{"mon":[{"open":"1700","close":"2300"}],"tue":[{"open":"1700","close":"2300"}],"wed":[{"open":"1700","close":"2300"}],"thu":[{"open":"1700","close":"2300"}],"fri":[{"open":"1700","close":"0000"}],"sat":[{"open":"1700","close":"0000"}],"sun":[{"open":"1700","close":"2230"}]}'::jsonb,
   'closing_soon', '{"ends_at":"2026-05-31","reason":"rooftop pop-up final month"}'::jsonb, 0.88, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Little Havana', 1.2889, 103.8472, '3A River Valley Rd, Clarke Quay',
   array['latin','cuban'], array['adventurous','loud','outdoor'], array[]::text[], 2, true,
   'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800',
   'https://book.chope.co/booking?rid=little-havana',
   '{"mon":[{"open":"1700","close":"2330"}],"tue":[{"open":"1700","close":"2330"}],"wed":[{"open":"1700","close":"2330"}],"thu":[{"open":"1700","close":"2330"}],"fri":[{"open":"1700","close":"0200"}],"sat":[{"open":"1700","close":"0200"}],"sun":[{"open":"1700","close":"2300"}]}'::jsonb,
   'none', null, 0.4, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Yuzu Mezze', 1.2913, 103.8411, '30 Robertson Quay',
   array['japanese','mediterranean','fusion'], array['adventurous','cozy'], array['vegetarian_friendly'], 3, false,
   'https://images.unsplash.com/photo-1514326640560-7d063ef2aed5?w=800',
   'https://book.chope.co/booking?rid=yuzu-mezze',
   '{"mon":[],"tue":[{"open":"1800","close":"2230"}],"wed":[{"open":"1800","close":"2230"}],"thu":[{"open":"1800","close":"2230"}],"fri":[{"open":"1800","close":"2300"}],"sat":[{"open":"1800","close":"2300"}],"sun":[{"open":"1800","close":"2200"}]}'::jsonb,
   'soft_launch', '{"opened":"2026-02-20"}'::jsonb, 0.68, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Dumpling Den', 1.2831, 103.8438, '18 Smith St, Chinatown',
   array['chinese','dim_sum','dumplings'], array['low_key','loud'], array[]::text[], 1, false,
   'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800',
   'https://book.chope.co/booking?rid=dumpling-den',
   '{"mon":[{"open":"1100","close":"2200"}],"tue":[{"open":"1100","close":"2200"}],"wed":[{"open":"1100","close":"2200"}],"thu":[{"open":"1100","close":"2200"}],"fri":[{"open":"1100","close":"2230"}],"sat":[{"open":"1100","close":"2230"}],"sun":[{"open":"1100","close":"2200"}]}'::jsonb,
   'none', null, 0.25, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Ember & Oak', 1.3059, 103.8105, 'Block 11 Dempsey Rd',
   array['modern_european','grill'], array['celebratory','outdoor','romantic'], array[]::text[], 4, true,
   'https://images.unsplash.com/photo-1544148103-0773bf10d330?w=800',
   'https://book.chope.co/booking?rid=ember-oak',
   '{"mon":[],"tue":[{"open":"1830","close":"2230"}],"wed":[{"open":"1830","close":"2230"}],"thu":[{"open":"1830","close":"2230"}],"fri":[{"open":"1830","close":"2300"}],"sat":[{"open":"1830","close":"2300"}],"sun":[{"open":"1830","close":"2200"}]}'::jsonb,
   'award_fresh', '{"award":"Asia 50 Best 2026 newcomer"}'::jsonb, 0.82, true);

insert into venues (name, lat, lng, address, cuisine_tags, vibe_tags, dietary_flags, budget_band, is_outdoor, photo_url, chope_url, hours_json, badge, badge_meta, trending_score, active) values
  ('Noodle Alley', 1.3107, 103.7953, 'Holland Drive Food Centre',
   array['thai','street_food'], array['low_key','loud'], array[]::text[], 1, false,
   'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800',
   'https://book.chope.co/booking?rid=noodle-alley',
   '{"mon":[{"open":"1100","close":"2100"}],"tue":[{"open":"1100","close":"2100"}],"wed":[{"open":"1100","close":"2100"}],"thu":[{"open":"1100","close":"2100"}],"fri":[{"open":"1100","close":"2130"}],"sat":[{"open":"1100","close":"2130"}],"sun":[{"open":"1100","close":"2100"}]}'::jsonb,
   'none', null, 0.2, true);
