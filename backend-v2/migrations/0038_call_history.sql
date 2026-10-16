-- История звонков (#713): комната хранит, чем закончился звонок.
--
-- answered_at — собеседник вошёл в комнату; ended_at — комната закрылась.
-- callee_id — кого звали; invited_at — приглашение до него дошло: только
-- тогда звонок есть и в его истории. end_reason — итог для неотвеченного
-- звонка (declined — отклонил, busy — занят или заблокировал, no_answer —
-- не ответил, cancelled — звонящий положил трубку); у отвеченного — answered.
ALTER TABLE calls.rooms
    ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS callee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS end_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calls_rooms_end_reason_check'
          AND conrelid = 'calls.rooms'::regclass
    ) THEN
        ALTER TABLE calls.rooms
            ADD CONSTRAINT calls_rooms_end_reason_check
            CHECK (end_reason IN ('answered', 'declined', 'busy', 'no_answer', 'cancelled'));
    END IF;
END $$;

-- Лента истории — по звонящему и по тому, кого звали, от новых к старым.
CREATE INDEX IF NOT EXISTS calls_rooms_initiator_history_idx
    ON calls.rooms (initiator_id, created_at DESC, id DESC)
    WHERE ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_rooms_callee_history_idx
    ON calls.rooms (callee_id, created_at DESC, id DESC)
    WHERE ended_at IS NOT NULL AND invited_at IS NOT NULL;
