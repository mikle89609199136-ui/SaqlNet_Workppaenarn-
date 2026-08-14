-- Quick Performance Test Data Generation
-- Optimized for existing database schema

DO $$ 
DECLARE
    v_num_users INT := 30;              
    v_num_chats INT := 50;              
    v_num_private_chats INT := 100;     
    v_msgs_per_chat INT := 100;         
    
    v_user_id UUID;
    v_chat_id UUID;
    v_message_id UUID;
    v_sender_id UUID;
    v_member_id UUID;
    v_i INT;
    v_j INT;
BEGIN
    RAISE NOTICE 'Starting performance test data generation (simplified)...';
    
    -- 1. Create test users
    RAISE NOTICE 'Creating % test users...', v_num_users;
    FOR v_i IN 1..v_num_users LOOP
        INSERT INTO auth.users (username, password_hash, username_discriminator, first_name)
        VALUES (
            'testuser_' || v_i,
            '$2a$10$dummy_hash_' || v_i,
            (v_i % 100),
            'TestUser'
        )
        ON CONFLICT DO NOTHING;
        
        INSERT INTO users.profiles (user_id, first_name, last_name, avatar_url)
        SELECT id, 'Test', 'User ' || v_i, 'https://api.example.com/avatar/' || v_i || '.jpg'
        FROM auth.users 
        WHERE username = 'testuser_' || v_i
        ON CONFLICT DO NOTHING;
    END LOOP;
    
    -- 2. Create group chats
    RAISE NOTICE 'Creating % group chats...', v_num_chats;
    FOR v_i IN 1..v_num_chats LOOP
        v_user_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_i % v_num_users) + 1) LIMIT 1);
        
        IF v_user_id IS NOT NULL THEN
            INSERT INTO chats.chats (type, title, description, avatar_url, owner_id)
            VALUES (
                'group',
                'Group Chat #' || v_i,
                'Test group chat #' || v_i,
                'https://api.example.com/group_avatar/' || v_i || '.jpg',
                v_user_id
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    
    -- 3. Add members to group chats
    RAISE NOTICE 'Adding members to chats...';
    FOR v_chat_id IN (SELECT id FROM chats.chats WHERE type = 'group' ORDER BY created_at DESC LIMIT v_num_chats) LOOP
        FOR v_j IN 1..5 LOOP
            v_member_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_j % v_num_users) + 1) LIMIT 1);
            
            IF v_member_id IS NOT NULL THEN
                INSERT INTO chats.members (chat_id, user_id, role, joined_at)
                VALUES (v_chat_id, v_member_id, 'member', NOW() - INTERVAL '1 day')
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
    
    -- 4. Create private chats
    RAISE NOTICE 'Creating % private chats...', v_num_private_chats;
    FOR v_i IN 1..v_num_private_chats LOOP
        v_user_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || ((v_i % v_num_users) + 1) LIMIT 1);
        v_member_id := (SELECT id FROM auth.users WHERE username = 'testuser_' || (((v_i + 7) % v_num_users) + 1) LIMIT 1);
        
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
    RAISE NOTICE 'Creating messages (% per chat)...', v_msgs_per_chat;
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
                    'Test message #' || v_i,
                    'text',
                    NOW() - INTERVAL '1 minute' * (RANDOM()::INT % (v_msgs_per_chat * 2)),
                    NOW() - INTERVAL '1 minute' * (RANDOM()::INT % (v_msgs_per_chat * 2))
                );
            END IF;
        END LOOP;
    END LOOP;
    
    RAISE NOTICE 'Data generation completed!';
    RAISE NOTICE 'Summary:';
    RAISE NOTICE '  Users created: %', (SELECT COUNT(*) FROM auth.users WHERE username LIKE 'testuser_%');
    RAISE NOTICE '  Chats created: %', (SELECT COUNT(*) FROM chats.chats);
    RAISE NOTICE '  Chat members: %', (SELECT COUNT(*) FROM chats.members);
    RAISE NOTICE '  Messages created: %', (SELECT COUNT(*) FROM messages.messages);
END $$;
