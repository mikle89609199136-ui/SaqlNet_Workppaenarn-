-- Legacy GIFs may be global and therefore have no owning user.
ALTER TABLE media.gifs
    ALTER COLUMN user_id DROP NOT NULL;
