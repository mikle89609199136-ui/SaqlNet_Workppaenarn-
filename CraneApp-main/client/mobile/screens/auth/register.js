const existingToken = localStorage.getItem('craneapp_auth_token');
if (existingToken) location.href = '/client/mobile/screens/chats/chats.html';

let currentStep = 1;
let avatarBase64 = null;

function tr(key, fallback, vars) {
    return window.i18n?.t(key, vars) || fallback;
}

function goTo(n) {
    const cur = document.getElementById('step' + currentStep);
    cur.classList.remove('active');
    cur.classList.add('exit');
    setTimeout(() => cur.classList.remove('exit'), 350);
    currentStep = n;
    const next = document.getElementById('step' + n);
    next.classList.add('active');
}

function handleAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        avatarBase64 = e.target.result;
        const upload = document.getElementById('avatarUpload');
        upload.innerHTML = '<img src="' + avatarBase64 + '"><div class="avatar-edit-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>';
        upload.style.border = '2px solid rgba(255,0,127,0.4)';
    };
    reader.readAsDataURL(file);
}

function step2Next() {
    const name = document.getElementById('firstName').value.trim();
    if (!name) { showToast('error', tr('enterName', 'Введите имя'), '⚠️'); return; }
    goTo(3);
}

function toggleEye(inputId, iconId, e) {
    e.preventDefault();
    const inp = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (inp.type === 'password') {
        inp.type = 'text';
        icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
        icon.setAttribute('stroke','rgba(255,0,127,0.8)');
    } else {
        inp.type = 'password';
        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
        icon.setAttribute('stroke','rgba(255,255,255,0.4)');
    }
}

function checkPwStrength() {
    const pw = document.getElementById('password').value;
    const bar = document.getElementById('pwBar');
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    const colors = ['#FF4B4B','#FF8C00','#FFD700','#00C853','#00E676'];
    const widths = ['20%','40%','60%','80%','100%'];
    bar.style.width = score > 0 ? widths[score-1] : '0%';
    bar.style.background = score > 0 ? colors[score-1] : 'transparent';
}

async function doRegister() {
    const firstName = document.getElementById('firstName').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const password2 = document.getElementById('password2').value;
    const btn = document.getElementById('registerBtn');

    if (username.length < 5) { showToast('error', tr('usernameMinError', 'Юзернейм: минимум 5 символов'), '⚠️'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { showToast('error', tr('usernameFormatError', 'Только буквы, цифры и _'), '⚠️'); return; }
    if (password.length < 6) { showToast('error', tr('passwordMinError', 'Пароль минимум 6 символов'), '⚠️'); return; }
    if (password !== password2) { showToast('error', tr('passwordsMismatch', 'Пароли не совпадают'), '⚠️'); return; }

    btn.disabled = true;
    btn.textContent = tr('creatingAccount', 'Создание аккаунта...');

    try {
        const res = await fetch('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, firstName, lastName: '', language: window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || tr('registerError', 'Ошибка регистрации'));

        localStorage.setItem('craneapp_auth_token', data.token);
        const u = data.user;
        localStorage.setItem('craneapp_user_data', JSON.stringify({
            id: u.id, username: u.username, firstName: u.firstName,
            lastName: u.lastName || '', bio: '', avatarUrl: ''
        }));
        localStorage.setItem('craneapp_settings', JSON.stringify({
            theme: 'dark', notifications: true, sounds: true, language: window.i18n?.currentLang || localStorage.getItem('craneapp_language') || 'ru'
        }));

        // Загружаем аватарку если выбрана
        if (avatarBase64) {
            fetch('/api/v1/users/avatar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + data.token },
                body: JSON.stringify({ avatar: avatarBase64 })
            }).catch(() => {});
        }

        showToast('success', tr('welcomeDone', 'Добро пожаловать!'), '🎉');
        setTimeout(() => location.href = '/client/mobile/screens/chats/chats.html', 600);
    } catch (err) {
        showToast('error', err.message, '❌');
        btn.disabled = false;
        btn.textContent = tr('createAccount', 'Создать аккаунт');
    }
}

function showToast(type, msg, icon) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'success' ? 'success' : '');
    t.innerHTML = '<span>' + icon + '</span><span>' + msg + '</span>';
    c.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    const p2 = document.getElementById('password2');
    if (p2) {
        p2.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doRegister();
            }
        });
    }
});
