-- Performance Testing Data Generation Script
-- Generates realistic chat and message data for performance testing

-- Configuration
DO $$ 
DECLARE
    v_num_users INT := 50;              -- Number of test users
    v_num_chats INT := 100;             -- Number of group chats
    v_num_private_chats INT := 200;     -- Number of private chats
    v_msgs_per_chat INT := 500;         -- Messages per chat
    v_reactions_ratio DECIMAL := 0.1;   -- 10% of messages get reactions
    v_pins_ratio DECIMAL := 0.02;       -- 2% of messages are pinned
    
    v_user_id UUID;
    v_chat_id UUID;
    v_message_id UUID;
    v_sender_id UUID;
    v_member_id UUID;
    v_i INT;
    v_j INT;
    v_k INT;
BEGIN
    RAISE NOTICE 'Starting performance test data generation...';
    
    -- Clean existing test data (optional - comment out if preserving existing)
    -- DELETE FROM messages.reactions;
    -- DELETE FROM messages.pins;
    -- DELETE FROM messages.messages;
    -- DELETE FROM chats.members;
    -- DELETE FROM chats.bans;
    -- DELETE FROM chats.user_chat_settings;
    -- DELETE FROM chats.chats;
    -- DELETE FROM public.user_sessions;
    
    -- 1. Create test users (100-150 total including existing)
    RAISE NOTICE 'Creating test users...';
    FOR v_i IN 1..v_num_users LOOP
        INSERT INTO auth.users (username, email, password_hash, username_discriminator)
        VALUES (
            'testuser_' || v_i,
            'test' || v_i || '@example.com',
            '$2a$10$dummy_hash_' || v_i,
            v_i % 100
        )
        ON CONFLICT DO NOTHING;
        
        -- Create user profile
        INSERT INTO users.profiles (user_id, first_name, last_name, avatar_url)
        SELECT id, 'Test', 'User ' || v_i, 'https://api.example.com/avatar/' || v_i || '.jpg'
        FROM auth.users 
        WHERE username = 'testuser_' || v_i
        ON CONFLICT DO NOTHING;
        
        -- Create user sessions for some users (online status)
        INSERT INTO public.user_sessions (user_id, device_name, device_type, last_active)
        SELECT id, 'Test Device', 'web', NOW() - INTERVAL '1 minute'
        FROM auth.users
        WHERE username = 'testuser_' || v_i
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    -- 2. Create group chats
    RAISE NOTICE 'Creating group chats...';
    FOR v_i IN 1..v_num_chats LOOP
        v_user_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_i % v_num_users) + 1) LIMIT 1);
        
        INSERT INTO chats.chats (type, title, description, avatar_url, owner_id)
        VALUES (
            'group',
            'Group Chat #' || v_i,
            'Test group chat for performance testing #' || v_i,
            'https://api.example.com/group_avatar/' || v_i || '.jpg',
            v_user_id
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    -- 3. Add members to group chats
    RAISE NOTICE 'Adding members to group chats...';
    FOR v_chat_id IN (SELECT id FROM chats.chats WHERE type = 'group' LIMIT v_num_chats) LOOP
        FOR v_j IN 1..(5 + RANDOM()::INT % 10) LOOP  -- 5-15 members per chat
            v_member_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_j % v_num_users) + 1) LIMIT 1);
            
            INSERT INTO chats.members (chat_id, user_id, role, joined_at)
            VALUES (v_chat_id, v_member_id, 
                    CASE WHEN v_j = 1 THEN 'owner' ELSE 'member' END,
                    NOW() - INTERVAL '1 day' * RANDOM()::INT % 30)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
    
    -- 4. Create private chats
    RAISE NOTICE 'Creating private chats...';
    FOR v_i IN 1..v_num_private_chats LOOP
        v_user_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_i % v_num_users) + 1) LIMIT 1);
        v_member_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || (((v_i + 1) % v_num_users) + 1) LIMIT 1);
        
        IF v_user_id IS NOT NULL AND v_member_id IS NOT NULL AND v_user_id <> v_member_id THEN
            INSERT INTO chats.chats (type, owner_id)
            VALUES ('private', v_user_id)
            ON CONFLICT DO NOTHING
            RETURNING id INTO v_chat_id;
            
            IF v_chat_id IS NOT NULL THEN
                INSERT INTO chats.members (chat_id, user_id, role)
                VALUES 
                    (v_chat_id, v_user_id, 'owner'),
                    (v_chat_id, v_member_id, 'member')
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
    
    -- 5. Create messages
    RAISE NOTICE 'Creating messages...';
    FOR v_chat_id IN (SELECT id FROM chats.chats LIMIT (v_num_chats + v_num_private_chats)) LOOP
        FOR v_i IN 1..v_msgs_per_chat LOOP
            v_sender_id := (SELECT user_id FROM chats.members WHERE chat_id = v_chat_id ORDER BY RANDOM() LIMIT 1);
            
            IF v_sender_id IS NOT NULL THEN
                INSERT INTO messages.messages (
                    chat_id, sender_id, content, type,
                    created_at, updated_at
                )
                VALUES (
                    v_chat_id,
                    v_sender_id,
                    'Test message #' || v_i || ' in chat. Content: ' || 
                    (CASE WHEN RANDOM() < 0.3 THEN 'Hello @user123 check this out!' 
                          WHEN RANDOM() < 0.6 THEN 'This is a test message with some data'
                          ELSE 'Performance test message ' || v_i END),
                    'text',
                    NOW() - INTERVAL '1 minute' * RANDOM()::INT % (v_msgs_per_chat * 2),
                    NOW() - INTERVAL '1 minute' * RANDOM()::INT % (v_msgs_per_chat * 2)
                );
            END IF;
        END LOOP;
    END LOOP;
    
    -- 6. Add reactions to messages
    RAISE NOTICE 'Adding reactions to messages...';
    FOR v_message_id IN 
        (SELECT id FROM messages.messages ORDER BY RANDOM() LIMIT (
            SELECT COUNT(*) * v_reactions_ratio FROM messages.messages
        ))
    LOOP
        v_sender_id := (SELECT sender_id FROM messages.messages WHERE id = v_message_id);
        v_chat_id := (SELECT chat_id FROM messages.messages WHERE id = v_message_id);
        
        FOR v_j IN 1..3 LOOP  -- 1-3 reactions per message
            v_member_id := (SELECT user_id FROM chats.members WHERE chat_id = v_chat_id ORDER BY RANDOM() LIMIT 1);
            
            IF v_member_id IS NOT NULL AND v_member_id <> v_sender_id THEN
                INSERT INTO messages.reactions (message_id, user_id, emoji, created_at)
                VALUES (v_message_id, v_member_id, 
                        (ARRAY['👍', '❤️', '😂', '🎉', '😮', '😢'])[1 + RANDOM()::INT % 6],
                        NOW())
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
    
    -- 7. Pin some messages
    RAISE NOTICE 'Pinning messages...';
    FOR v_message_id IN
        (SELECT id FROM messages.messages ORDER BY RANDOM() LIMIT (
            SELECT COUNT(*) * v_pins_ratio FROM messages.messages
        ))
    LOOP
        v_chat_id := (SELECT chat_id FROM messages.messages WHERE id = v_message_id);
        v_sender_id := (SELECT user_id FROM chats.members WHERE chat_id = v_chat_id AND role IN ('owner', 'admin') ORDER BY RANDOM() LIMIT 1);
        
        IF v_sender_id IS NOT NULL THEN
            INSERT INTO messages.pins (chat_id, message_id, pinned_by, pinned_at)
            VALUES (v_chat_id, v_message_id, v_sender_id, NOW())
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    
    -- 8. Set user chat settings (for some chats)
    RAISE NOTICE 'Setting user chat settings...';
    INSERT INTO chats.user_chat_settings (user_id, chat_id, last_read_at, joined_at)
    SELECT cm.user_id, cm.chat_id, NOW() - INTERVAL '1 hour', cm.joined_at
    FROM chats.members cm
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Data generation completed!';
    RAISE NOTICE 'Summary:';
    RAISE NOTICE '  Users created: %', (SELECT COUNT(*) FROM auth.users WHERE username LIKE 'testuser_%');
    RAISE NOTICE '  Chats created: %', (SELECT COUNT(*) FROM chats.chats);
    RAISE NOTICE '  Chat members: %', (SELECT COUNT(*) FROM chats.members);
    RAISE NOTICE '  Messages created: %', (SELECT COUNT(*) FROM messages.messages);
    RAISE NOTICE '  Reactions created: %', (SELECT COUNT(*) FROM messages.reactions);
    RAISE NOTICE '  Pinned messages: %', (SELECT COUNT(*) FROM messages.pins);
END $$;
