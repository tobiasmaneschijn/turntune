-- Feedback submission must not impersonate an administrative workflow decision.
-- Revoke the table-level grant before granting the public submission fields.
revoke insert on table public.soundspin_feedback from authenticated;
grant insert (id, user_id, message, screenshot_paths, room_slug, page_path, viewport, category, impact, diagnostics)
  on table public.soundspin_feedback to authenticated;
