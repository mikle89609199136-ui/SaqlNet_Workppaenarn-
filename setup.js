/**
 * CraneApp Setup Script
 * Автоматически настраивает окружение перед первым запуском
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

console.log(`\n${CYAN}╔══════════════════════════════════════╗`);
console.log(`║       CraneApp Setup Wizard          ║`);
console.log(`╚══════════════════════════════════════╝${RESET}\n`);

async function main() {
    // ── 1. Проверяем .env ──────────────────────────────────────────────────
    const envPath = path.join(__dirname, '.env');
    let dbUrl = null;

    if (fs.existsSync(envPath)) {
        console.log(`${GREEN}✓ .env найден${RESET}`);
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/DATABASE_URL=(.+)/);
        if (match) dbUrl = match[1].trim();
    } else {
        console.log(`${YELLOW}⚠ .env не найден, создаём...${RESET}`);
    }

    // ── 2. Проверяем PostgreSQL ────────────────────────────────────────────
    let pgAvailable = false;
    let psqlPath = null;

    // Ищем psql в стандартных местах
    const pgPaths = [
        'psql',
        'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
        '/usr/bin/psql',
        '/usr/local/bin/psql'
    ];

    for (const p of pgPaths) {
        try {
            execSync(`"${p}" --version`, { stdio: 'ignore' });
            psqlPath = p;
            pgAvailable = true;
            break;
        } catch (_) {}
    }

    if (pgAvailable) {
        console.log(`${GREEN}✓ PostgreSQL найден: ${psqlPath}${RESET}`);
    } else {
        console.log(`${RED}✗ PostgreSQL не найден${RESET}`);
        console.log(`\n${YELLOW}Для работы CraneApp нужен PostgreSQL.`);
        console.log(`Скачайте и установите: https://www.postgresql.org/download/`);
        console.log(`\nПосле установки запустите этот скрипт снова: node setup.js${RESET}\n`);
        rl.close();
        process.exit(1);
    }

    // ── 3. Получаем данные для подключения ────────────────────────────────
    let pgPassword = '';
    let pgHost = 'localhost';
    let pgPort = '5432';
    let pgUser = 'postgres';
    let pgDb = 'craneapp';

    if (dbUrl) {
        // Парсим существующий DATABASE_URL
        try {
            const u = new URL(dbUrl);
            pgHost = u.hostname;
            pgPort = u.port || '5432';
            pgUser = u.username;
            pgPassword = u.password;
            pgDb = u.pathname.replace('/', '');
            console.log(`${GREEN}✓ Используем существующий DATABASE_URL${RESET}`);
        } catch (_) {}
    } else {
        console.log(`\n${CYAN}Настройка подключения к PostgreSQL:${RESET}`);
        pgPassword = await ask(`  Пароль для пользователя postgres: `);
    }

    // ── 4. Проверяем подключение ──────────────────────────────────────────
    console.log(`\n${CYAN}Проверяем подключение к PostgreSQL...${RESET}`);

    const env = { ...process.env, PGPASSWORD: pgPassword };

    try {
        execSync(`"${psqlPath}" -U ${pgUser} -h ${pgHost} -p ${pgPort} -c "SELECT 1;" postgres`, {
            env, stdio: 'ignore'
        });
        console.log(`${GREEN}✓ Подключение успешно${RESET}`);
    } catch (_) {
        console.log(`${RED}✗ Не удалось подключиться. Проверьте пароль и убедитесь что PostgreSQL запущен.${RESET}`);
        rl.close();
        process.exit(1);
    }

    // ── 5. Создаём базу данных если нет ──────────────────────────────────
    console.log(`${CYAN}Проверяем базу данных "${pgDb}"...${RESET}`);

    try {
        execSync(
            `"${psqlPath}" -U ${pgUser} -h ${pgHost} -p ${pgPort} -c "CREATE DATABASE ${pgDb};" postgres`,
            { env, stdio: 'ignore' }
        );
        console.log(`${GREEN}✓ База данных "${pgDb}" создана${RESET}`);
    } catch (_) {
        // Скорее всего уже существует
        console.log(`${GREEN}✓ База данных "${pgDb}" уже существует${RESET}`);
    }

    // ── 6. Создаём/обновляем .env ─────────────────────────────────────────
    const jwtSecret = 'craneapp-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    const newDbUrl = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDb}`;

    const envContent = `PORT=3000
NODE_ENV=development
JWT_SECRET=${jwtSecret}
DATABASE_URL=${newDbUrl}
`;

    fs.writeFileSync(envPath, envContent);
    console.log(`${GREEN}✓ .env создан/обновлён${RESET}`);

    // ── 7. Устанавливаем зависимости если нужно ───────────────────────────
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
        console.log(`\n${CYAN}Устанавливаем зависимости (npm install)...${RESET}`);
        try {
            execSync('npm install', { stdio: 'inherit' });
            console.log(`${GREEN}✓ Зависимости установлены${RESET}`);
        } catch (_) {
            console.log(`${RED}✗ Ошибка npm install${RESET}`);
        }
    } else {
        console.log(`${GREEN}✓ node_modules уже есть${RESET}`);
    }

    // ── Готово ─────────────────────────────────────────────────────────────
    console.log(`\n${GREEN}╔══════════════════════════════════════╗`);
    console.log(`║         Всё готово к запуску!        ║`);
    console.log(`╚══════════════════════════════════════╝${RESET}`);
    console.log(`\nЗапустите сервер командой:\n`);
    console.log(`  ${CYAN}npm run dev${RESET}\n`);
    console.log(`Затем откройте: ${CYAN}http://localhost:3000${RESET}\n`);

    rl.close();
}

main().catch(e => {
    console.error(`${RED}Ошибка:${RESET}`, e.message);
    rl.close();
    process.exit(1);
});
