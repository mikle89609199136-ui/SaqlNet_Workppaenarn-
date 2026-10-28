-- Personal pins disappear atomically when access or their message disappears.
CREATE TABLE IF NOT EXISTS messages.personal_pins (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats.chats(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id),
    FOREIGN KEY (chat_id, user_id) REFERENCES chats.members(chat_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS personal_pins_user_chat_order_idx
    ON messages.personal_pins(user_id, chat_id, pinned_at DESC, message_id DESC);

CREATE OR REPLACE FUNCTION messages.clear_personal_pins_on_soft_delete() RETURNS trigger AS $$
BEGIN
    DELETE FROM messages.personal_pins WHERE message_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_personal_pins_on_soft_delete ON messages.messages;
CREATE TRIGGER clear_personal_pins_on_soft_delete
    AFTER UPDATE OF deleted_at ON messages.messages
    FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
    EXECUTE FUNCTION messages.clear_personal_pins_on_soft_delete();
