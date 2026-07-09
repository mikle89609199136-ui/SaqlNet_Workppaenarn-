@echo off
:: Используем IP вместо localhost, чтобы избежать ECONNREFUSED
set ANTHROPIC_BASE_URL=http://127.0.0.1:20128/v1

:: OmniRoute может требовать ключ в ANTHROPIC_API_KEY
set ANTHROPIC_API_KEY=sk-9b99158ffc01f8f0-3f37b1-3cd3df61
set ANTHROPIC_AUTH_TOKEN=sk-9b99158ffc01f8f0-3f37b1-3cd3df61

:: Убедись, что эти имена моделей точно есть в списке Available Models в браузере
set ANTHROPIC_MODEL=kr/claude-sonnet-4.5
set ANTHROPIC_SMALL_FAST_MODEL=kr/claude-sonnet-4.5

set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

claude %*