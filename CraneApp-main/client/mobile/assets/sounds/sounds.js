/**
 * CraneApp Retro Ringtones & Notification Sounds
 */
window.CraneSounds = (function () {
    const N = {
        C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88,
        C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77,
        C6:1046.50, D6:1174.66, E6:1318.51,
        G3:196.00, A3:220.00, B3:246.94, F3:174.61,
        _:0
    };

    // Короткие звуки для уведомлений и сообщений (до 0.5 сек)
    const SHORT = {
        // Уведомления
        default:  [[N.E5,0.08],[N._,0.03],[N.E5,0.08]],
        note:     [[N.A4,0.12],[N.E5,0.12]],
        ping:     [[N.E6,0.06],[N._,0.02],[N.E6,0.06]],
        pop:      [[N.G5,0.04],[N.C5,0.08]],
        chord:    [[N.C5,0.15],[N.E5,0.15]],
        gentle:   [[N.C5,0.1],[N.E5,0.1],[N.G5,0.15]],
        // Сообщения
        bubble:   [[N.C6,0.04],[N.G5,0.04],[N.E5,0.04],[N.C5,0.08]],
        click:    [[N.A5,0.04]],
        tap:      [[N.E5,0.05],[N._,0.02],[N.G5,0.05]],
    };

    // Рингтоны — одна итерация (будет повторяться)
    const RINGTONE_LOOP = {
        // Nokia Grande Valse — только для рингтона
        default: [
            [N.E5,0.125],[N.D5,0.125],[N.F4,0.25],[N.G4,0.25],
            [N.C5,0.125],[N.B4,0.125],[N.D4,0.25],[N.E4,0.25],
            [N.B4,0.125],[N.A4,0.125],[N.C4,0.25],[N.E4,0.25],
            [N.A4,0.5],[N._,0.2],
            [N.E5,0.125],[N.D5,0.125],[N.F4,0.25],[N.G4,0.25],
            [N.C5,0.125],[N.B4,0.125],[N.D4,0.25],[N.E4,0.25],
            [N.B4,0.125],[N.A4,0.125],[N.C4,0.25],[N.E4,0.25],
            [N.A4,0.75],[N._,0.3],
        ],
        // Восходящая гамма с вариациями
        melody1: [
            [N.C4,0.12],[N.E4,0.12],[N.G4,0.12],[N.C5,0.12],
            [N.E5,0.12],[N.G5,0.12],[N.C6,0.25],[N._,0.08],
            [N.C6,0.12],[N.B5,0.12],[N.A5,0.12],[N.G5,0.12],
            [N.F5,0.12],[N.E5,0.12],[N.D5,0.12],[N.C5,0.25],[N._,0.08],
            [N.E5,0.12],[N.G5,0.12],[N.E5,0.12],[N.C5,0.12],
            [N.D5,0.12],[N.F5,0.12],[N.D5,0.12],[N.B4,0.12],
            [N.C5,0.4],[N._,0.2],
        ],
        // Весёлый мотив
        melody2: [
            [N.G4,0.1],[N.G4,0.1],[N.A4,0.1],[N.G4,0.1],[N.C5,0.1],[N.B4,0.2],[N._,0.05],
            [N.G4,0.1],[N.G4,0.1],[N.A4,0.1],[N.G4,0.1],[N.D5,0.1],[N.C5,0.2],[N._,0.05],
            [N.G4,0.1],[N.G4,0.1],[N.G5,0.1],[N.E5,0.1],[N.C5,0.1],[N.B4,0.1],[N.A4,0.2],[N._,0.05],
            [N.F5,0.1],[N.F5,0.1],[N.E5,0.1],[N.C5,0.1],[N.D5,0.1],[N.C5,0.3],[N._,0.2],
        ],
        // Классика (Imperial-style)
        classic: [
            [N.A4,0.2],[N._,0.05],[N.A4,0.2],[N._,0.05],[N.A4,0.2],[N._,0.05],
            [N.F4,0.15],[N.C5,0.1],[N.A4,0.2],[N._,0.05],[N.F4,0.15],[N.C5,0.1],[N.A4,0.4],[N._,0.1],
            [N.E5,0.2],[N._,0.05],[N.E5,0.2],[N._,0.05],[N.E5,0.2],[N._,0.05],
            [N.F5,0.15],[N.C5,0.1],[N.A4,0.2],[N._,0.05],[N.F4,0.15],[N.C5,0.1],[N.A4,0.4],[N._,0.3],
        ],
    };

    // Рингтоны играют с повтором, короткие — один раз
    // Для рингтонов isRingtone=true ИЛИ soundId в RINGTONE_IDS
    const RINGTONE_IDS = new Set(['default','melody1','melody2','classic']);

    let currentCtx = null;
    let loopTimer  = null;

    function stop() {
        if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
        if (currentCtx) { try { currentCtx.close(); } catch (_) {} currentCtx = null; }
    }

    function playNotes(ctx, notes, vol, startTime) {
        let t = startTime;
        notes.forEach(([freq, dur]) => {
            if (freq === 0) { t += dur; return; }
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(vol * 0.3, t + 0.01);
            gain.gain.setValueAtTime(vol * 0.3, t + dur - 0.02);
            gain.gain.linearRampToValueAtTime(0, t + dur);
            osc.start(t);
            osc.stop(t + dur);
            t += dur;
        });
        return t;
    }

    function totalDuration(notes) {
        return notes.reduce((s, [, d]) => s + d, 0);
    }

    function play(soundId, volume, isRingtone) {
        stop();
        const vol = (volume !== undefined ? volume : 80) / 100;

        // isRingtone явно передан из sounds.html для секции "Рингтоны"
        const useLoop = isRingtone === true;

        if (useLoop) {
            const notes = RINGTONE_LOOP[soundId] || RINGTONE_LOOP.default;
            const dur   = totalDuration(notes);
            function loop() {
                try {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    currentCtx = ctx;
                    playNotes(ctx, notes, vol, ctx.currentTime + 0.05);
                    loopTimer = setTimeout(() => {
                        try { ctx.close(); } catch (_) {}
                        loop();
                    }, (dur + 0.1) * 1000);
                } catch (e) {}
            }
            loop();
        } else {
            // Короткий звук — один раз
            const notes = SHORT[soundId] || SHORT.default;
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                currentCtx = ctx;
                playNotes(ctx, notes, vol, ctx.currentTime + 0.05);
            } catch (e) {}
        }
    }

    return { play, stop };
})();
