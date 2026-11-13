-- Indexes for the columns the team portal filters by that had none.
--
-- Only indexes: no table, column, row, rule or permission changes. Each one
-- matches a filter the pages and routes already run:
--   sessions (status)                 every events list and calendar: status = 'submitted'
--   shift_handoffs (session_id, status) the manager view's handoff panel
--   shift_handoffs (from_staff_id)    reliability lines on the Staff page and Team tab
--   event_closeouts (staff_id)        reliability lines
--   bar_ready_reports (staff_id)      reliability lines
--   order_sheet_lines (session_id)    the Shopping list (the existing key index only covers rows with a line key)
--   event_messages (created_at)       the chat check every 20 seconds (recent messages)
--   event_chat_mutes (staff_id)       the chat check and the manager chat
--   conversation_logs (session_id)    the concierge chat and client links
-- Safe to run twice.

begin;

create index if not exists sessions_status_idx on public.sessions (status);
create index if not exists shift_handoffs_session_status_idx on public.shift_handoffs (session_id, status);
create index if not exists shift_handoffs_from_staff_idx on public.shift_handoffs (from_staff_id);
create index if not exists event_closeouts_staff_idx on public.event_closeouts (staff_id);
create index if not exists bar_ready_reports_staff_idx on public.bar_ready_reports (staff_id);
create index if not exists order_sheet_lines_session_idx on public.order_sheet_lines (session_id);
create index if not exists event_messages_created_idx on public.event_messages (created_at);
create index if not exists event_chat_mutes_staff_idx on public.event_chat_mutes (staff_id);
create index if not exists conversation_logs_session_idx on public.conversation_logs (session_id);

commit;
