-- Add 'organiser_dm' to the mom_method allow-list
ALTER TABLE soccer.session_schedules
  DROP CONSTRAINT IF EXISTS session_schedules_mom_method_check;

ALTER TABLE soccer.session_schedules
  ADD CONSTRAINT session_schedules_mom_method_check
  CHECK (mom_method IN ('auto', 'whatsapp_poll', 'web_link', 'organiser_dm'));

-- Switch tonight's schedule to organiser_dm for the test
UPDATE soccer.session_schedules
SET mom_method = 'organiser_dm'
WHERE id = 'e6e81fcf-2287-4f66-96fa-fcab9619670f';;
