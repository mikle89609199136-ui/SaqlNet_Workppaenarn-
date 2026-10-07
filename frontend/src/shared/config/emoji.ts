/*
 * Набор эмодзи (#824) — как в макете: панель в поле ввода и быстрые
 * реакции. Картинки Noto лежат в статике приложения (`public/emoji/noto`):
 * SVG — у всего набора, анимация — у быстрых реакций. Эмодзи не из набора
 * рисует шрифт Noto Color Emoji (#816), так что вид везде один.
 */

export type TEmojiCategoryKey = 'recent' | 'smileys' | 'gestures' | 'hearts' | 'objects';

export interface IEmojiCategory {
  key: TEmojiCategoryKey;
  /** Ключ перевода и запасной текст. */
  label: readonly [string, string];
  /** Значок вкладки. */
  icon: string;
  emoji: readonly string[];
}

export const EMOJI_CATEGORIES: readonly IEmojiCategory[] = [
  { key: 'recent', label: ['emoji.recent', 'Недавние'], icon: '🕘', emoji: [] },
  {
    key: 'smileys',
    label: ['emoji.smileys', 'Смайлы'],
    icon: '😀',
    emoji: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '😂',
      '🤣',
      '🙂',
      '🙃',
      '😉',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😋',
      '😜',
      '🤪',
      '🤔',
      '🤨',
      '😐',
      '🙄',
      '😏',
      '😴',
      '😌',
      '🥲',
      '😭',
      '😤',
      '😡',
      '🤯',
      '😱',
      '🥶',
      '😳',
      '🤗',
      '🤫',
      '😎',
    ],
  },
  {
    key: 'gestures',
    label: ['emoji.gestures', 'Жесты'],
    icon: '👍',
    emoji: [
      '👍',
      '👎',
      '👌',
      '✌️',
      '🤞',
      '🤝',
      '👏',
      '🙌',
      '👐',
      '🙏',
      '💪',
      '👀',
      '👋',
      '🤙',
      '☝️',
      '👆',
      '👇',
      '👉',
      '👈',
      '✍️',
      '🫶',
      '🤘',
      '🖐️',
      '✊',
    ],
  },
  {
    key: 'hearts',
    label: ['emoji.hearts', 'Сердца'],
    icon: '💜',
    emoji: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❣️',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
    ],
  },
  {
    key: 'objects',
    label: ['emoji.objects', 'Разное'],
    icon: '🎉',
    emoji: [
      '🎉',
      '🎊',
      '🎁',
      '🏆',
      '⚽',
      '🎮',
      '🎧',
      '🎵',
      '☕',
      '🍕',
      '🍰',
      '🍺',
      '💻',
      '📱',
      '📷',
      '🔑',
      '💡',
      '📌',
      '✅',
      '❌',
      '⚡',
      '🔥',
      '⭐',
      '🚀',
    ],
  },
];

/** Быстрые реакции — в меню сообщения; у них есть анимация. */
export const QUICK_REACTIONS: readonly { emoji: string; label: readonly [string, string] }[] = [
  { emoji: '👍', label: ['reaction.like', 'Нравится'] },
  { emoji: '❤️', label: ['reaction.heart', 'Сердце'] },
  { emoji: '😂', label: ['reaction.lol', 'Смешно'] },
  { emoji: '🔥', label: ['reaction.fire', 'Огонь'] },
  { emoji: '🙏', label: ['reaction.thanks', 'Спасибо'] },
  { emoji: '🎉', label: ['reaction.party', 'Ура'] },
];

/** «Недавние», пока человек сам ничего не выбрал. */
export const DEFAULT_RECENT_EMOJI: readonly string[] = [
  '👍',
  '❤️',
  '😂',
  '🔥',
  '🙏',
  '👀',
  '✅',
  '🎉',
];

/** Сколько помнить недавних. */
export const RECENT_EMOJI_LIMIT = 24;

/**
 * Слова для поиска: по-русски и по-английски. Поиск идёт по обоим языкам,
 * первое слово на языке интерфейса — подпись кнопки.
 */
export const EMOJI_KEYWORDS: Readonly<Record<string, readonly [ru: string, en: string]>> = {
  '😀': ['улыбка, радость', 'grinning, smile'],
  '😃': ['улыбка, радость', 'smiley, happy'],
  '😄': ['смех, улыбка', 'smile, laugh'],
  '😁': ['широкая улыбка, зубы', 'grin, beaming'],
  '😆': ['хохот, смех', 'laughing, squint'],
  '😅': ['неловко, пот', 'sweat smile, awkward'],
  '😂': ['смех до слёз, ржу', 'joy, lol, tears'],
  '🤣': ['катаюсь от смеха, ржу', 'rofl, rolling'],
  '🙂': ['лёгкая улыбка, норм', 'slight smile, ok'],
  '🙃': ['вверх ногами, ирония', 'upside down'],
  '😉': ['подмигивание', 'wink'],
  '😊': ['улыбка, румянец', 'blush, smiling'],
  '😇': ['ангел, нимб', 'innocent, halo, angel'],
  '🥰': ['влюблён, сердечки', 'love, hearts'],
  '😍': ['влюблён, глаза-сердца', 'heart eyes, love'],
  '🤩': ['звёзды, восторг', 'star struck, wow'],
  '😘': ['поцелуй, воздушный', 'kiss, blow'],
  '😋': ['вкусно, язык', 'yum, tasty'],
  '😜': ['подмигивание, язык, шутка', 'wink tongue, joke'],
  '🤪': ['сумасшедший, безумный', 'zany, crazy'],
  '🤔': ['думаю, хм', 'thinking, hmm'],
  '🤨': ['сомнение, бровь', 'raised eyebrow, doubt'],
  '😐': ['нейтрально, без эмоций', 'neutral, meh'],
  '🙄': ['закатить глаза, ну-ну', 'eye roll'],
  '😏': ['ухмылка', 'smirk'],
  '😴': ['сплю, сон', 'sleeping, zzz'],
  '😌': ['облегчение, спокойно', 'relieved, calm'],
  '🥲': ['улыбка сквозь слёзы', 'tear smile'],
  '😭': ['плачу, рыдаю', 'crying, sob'],
  '😤': ['фыркаю, злюсь', 'huff, triumph'],
  '😡': ['злость, ярость', 'angry, rage'],
  '🤯': ['взрыв мозга, шок', 'mind blown, exploding'],
  '😱': ['ужас, крик', 'scream, fear'],
  '🥶': ['холодно, мёрзну', 'cold, freezing'],
  '😳': ['смущение, ого', 'flushed, embarrassed'],
  '🤗': ['обнимаю, объятия', 'hug, hugging'],
  '🤫': ['тише, секрет', 'shush, quiet'],
  '😎': ['крутой, очки', 'cool, sunglasses'],
  '👍': ['класс, лайк, да', 'thumbs up, like, yes'],
  '👎': ['не нравится, нет, дизлайк', 'thumbs down, dislike, no'],
  '👌': ['окей, отлично', 'ok, ok hand, perfect'],
  '✌️': ['мир, победа', 'peace, victory'],
  '🤞': ['скрестил пальцы, удачи', 'fingers crossed, luck'],
  '🤝': ['рукопожатие, договорились', 'handshake, deal'],
  '👏': ['аплодисменты, браво', 'clap, applause'],
  '🙌': ['ура, руки вверх', 'raising hands, hooray'],
  '👐': ['открытые ладони', 'open hands'],
  '🙏': ['спасибо, пожалуйста, молюсь', 'thanks, please, pray'],
  '💪': ['сила, мышцы', 'strong, muscle'],
  '👀': ['смотрю, глаза', 'eyes, look'],
  '👋': ['привет, пока', 'wave, hello, bye'],
  '🤙': ['созвонимся, звони', 'call me, shaka'],
  '☝️': ['внимание, один', 'index up, attention'],
  '👆': ['выше, вверх', 'point up'],
  '👇': ['ниже, вниз', 'point down'],
  '👉': ['вправо, туда', 'point right'],
  '👈': ['влево, сюда', 'point left'],
  '✍️': ['пишу, запись', 'writing'],
  '🫶': ['сердце руками, люблю', 'heart hands, love'],
  '🤘': ['рок, коза', 'rock, horns'],
  '🖐️': ['ладонь, стоп', 'hand, stop'],
  '✊': ['кулак, держись', 'fist, raised fist'],
  '❤️': ['сердце, любовь', 'red heart, love'],
  '🧡': ['оранжевое сердце', 'orange heart'],
  '💛': ['жёлтое сердце', 'yellow heart'],
  '💚': ['зелёное сердце', 'green heart'],
  '💙': ['синее сердце', 'blue heart'],
  '💜': ['фиолетовое сердце', 'purple heart'],
  '🖤': ['чёрное сердце', 'black heart'],
  '🤍': ['белое сердце', 'white heart'],
  '🤎': ['коричневое сердце', 'brown heart'],
  '💔': ['разбитое сердце', 'broken heart'],
  '❣️': ['сердце-восклицание', 'heart exclamation'],
  '💕': ['два сердца', 'two hearts'],
  '💞': ['кружащиеся сердца', 'revolving hearts'],
  '💓': ['бьющееся сердце', 'beating heart'],
  '💗': ['растущее сердце', 'growing heart'],
  '💖': ['сверкающее сердце', 'sparkling heart'],
  '💘': ['сердце со стрелой, амур', 'cupid, arrow'],
  '💝': ['сердце-подарок', 'heart gift, ribbon'],
  '🎉': ['праздник, ура, хлопушка', 'party, tada, celebrate'],
  '🎊': ['конфетти, праздник', 'confetti'],
  '🎁': ['подарок', 'gift, present'],
  '🏆': ['кубок, победа', 'trophy, win'],
  '⚽': ['футбол, мяч', 'soccer, football'],
  '🎮': ['игра, геймпад', 'game, gamepad'],
  '🎧': ['наушники, музыка', 'headphones'],
  '🎵': ['нота, музыка', 'music, note'],
  '☕': ['кофе, чай', 'coffee, tea'],
  '🍕': ['пицца', 'pizza'],
  '🍰': ['торт, пирожное', 'cake'],
  '🍺': ['пиво', 'beer'],
  '💻': ['ноутбук, код', 'laptop, code'],
  '📱': ['телефон, смартфон', 'phone, mobile'],
  '📷': ['фото, камера', 'camera, photo'],
  '🔑': ['ключ, пароль', 'key, password'],
  '💡': ['идея, лампочка', 'idea, bulb'],
  '📌': ['закреплено, кнопка', 'pin, pushpin'],
  '✅': ['готово, галочка', 'done, check'],
  '❌': ['нет, отмена, крестик', 'no, cross, cancel'],
  '⚡': ['молния, быстро', 'lightning, fast'],
  '🔥': ['огонь, жара', 'fire, lit'],
  '⭐': ['звезда, избранное', 'star'],
  '🚀': ['ракета, релиз, запуск', 'rocket, launch'],
  '🕘': ['часы, время', 'clock, time'],
};

/** Имя файла Noto: кодовые точки без селектора вида FE0F — «❤️» → `2764`. */
export function notoCode(emoji: string): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((code) => code !== 'fe0f')
    .join('_');
}

/** Эмодзи, у которых есть картинка в статике, и те, у кого есть анимация. */
export const NOTO_STATIC: ReadonlySet<string> = new Set(
  [
    ...EMOJI_CATEGORIES.flatMap((category) => [category.icon, ...category.emoji]),
    ...QUICK_REACTIONS.map((reaction) => reaction.emoji),
  ].map(notoCode)
);
export const NOTO_ANIMATED: ReadonlySet<string> = new Set(
  QUICK_REACTIONS.map((reaction) => notoCode(reaction.emoji))
);
