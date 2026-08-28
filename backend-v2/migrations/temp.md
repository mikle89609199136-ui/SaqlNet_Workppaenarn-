git branch "feature/CHAT-F002-limit-reaction-to-one-emoji"

git checkout "feature/CHAT-F002-limit-reaction-to-one-emoji"

git checkout -b "feature/CHAT-F002-01-change-reaction-constraints-DB"

git add ./backend-v2/migrations/0022_single_user_message_reaction.sql

git commit -m "Made migration, removing old data"

git push -u origin "feature/CHAT-F002-01-change-reaction-constraints-DB"

git checkout -b "feature/CHAT-F002-02-create-atomic-toggle-replace-emoji"

git checkout -b "feature/CHAT-F002-03-clarify-API-response"

git checkout -b "feature/CHAT-F002-04-update-Web-socket-event"

git checkout -b "feature/CHAT-F002-05-add-unit-tests"

git fetch origin # Скачивает все новое с сервера и обновляет origin/*
git merge origin/master # Вливает свежий мастер в dev1
