import { test, expect, send, openChat, waitForHistory } from './fixtures/pair';
import { uniqueMarker } from './fixtures/accounts';
import { messageWithText } from './fixtures/session';

// Ровно пять сценариев #277; реальные WebCrypto, IndexedDB, HTTP и WS.
test('зашифрованный round-trip между двумя браузерами', async ({ pair }) => {
  const { sender, receiver } = pair;
  for (const page of [sender, receiver]) {
    const privateKey = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('craneapp_crypto');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction('keys').objectStore('keys').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return values.some((value) => {
          const identity = value as { ecdhPrivate?: CryptoKey };
          return identity?.ecdhPrivate instanceof CryptoKey && !identity.ecdhPrivate.extractable;
        });
      } finally {
        db.close();
      }
    });
    expect(privateKey).toBe(true);
  }
  const text = uniqueMarker('crypto');
  await expect(sender.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeEditable({
    timeout: 60_000,
  });
  const response = sender.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/v2/messages/${pair.directChatId}`
  );
  await send(sender, text);
  const sent = await response;
  expect(sent.ok()).toBe(true);
  const wire = sent.request().postDataJSON();
  expect(JSON.stringify(wire)).not.toContain(text);
  expect(JSON.parse(wire.messages[0].content)).toMatchObject({ v: 2, e2e: true });
  await expect(messageWithText(receiver, text)).toBeVisible();
  const reply = uniqueMarker('reply');
  await send(receiver, reply);
  await expect(messageWithText(sender, reply)).toBeVisible();
});

test('групповое сообщение', async ({ pair }) => {
  const response = await pair.senderContext.request.post('/api/v2/chats/groups', {
    headers: { Origin: new URL(pair.sender.url()).origin },
    data: { title: uniqueMarker('group'), members: [pair.B.user.id] },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const chatId = body.chatId ?? body.chat?.id ?? body.id;
  expect(chatId).toBeTruthy();
  try {
    await openChat(pair.receiver, chatId);
    await openChat(pair.sender, chatId);
    const text = uniqueMarker('group-message');
    await send(pair.sender, text);
    await expect(messageWithText(pair.receiver, text)).toBeVisible();
  } finally {
    await openChat(pair.receiver, pair.directChatId);
    await openChat(pair.sender, pair.directChatId);
  }
});

test('зашифрованное медиа проходит загрузку и скачивание', async ({ pair }) => {
  const bytes = await pair.sender.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(255, 0, 0)';
    context.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/png')
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const caption = uniqueMarker('media');
  const name = `${caption}.png`;
  await pair.sender.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(caption);
  await pair.sender
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(bytes) });
  const upload = pair.sender.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v2/media'
  );
  await pair.sender.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const response = await upload;
  expect(response.status()).toBe(201);
  const wire = response.request().postDataJSON();
  expect(wire.file).toMatchObject({ version: 2, encrypted: true, algorithm: 'AES-GCM' });
  expect(wire.file.ciphertext).not.toBe(Buffer.from(bytes).toString('base64'));
  const image = messageWithText(pair.receiver, caption).locator('img.message-media');
  await expect(image).toHaveCount(1);
  const restored = await image.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    return [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())];
  });
  expect(restored).toEqual(bytes);
  await expect(
    pair.sender.getByRole('button', { name: 'Записать голосовое', exact: true })
  ).toBeVisible({ timeout: 60_000 });
});

test('реальный WS восстанавливает пропущенное сообщение без перезагрузки', async ({ pair }) => {
  test.setTimeout(120_000);
  const { receiver, receiverContext, sender } = pair;
  const sockets: string[] = [];
  receiver.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws') sockets.push(socket.url());
  });
  const documentId = uniqueMarker('document');
  await receiver.evaluate((id) => Object.assign(window, { __e2eDocument: id }), documentId);
  await receiverContext.setOffline(true);
  try {
    const closed = await receiver.evaluate(() => {
      const sockets = (window as unknown as { __e2eSockets: WebSocket[] }).__e2eSockets;
      const socket = sockets.find((socket) => socket.readyState === WebSocket.OPEN);
      if (!socket) return false;
      socket.close();
      return true;
    });
    expect(closed).toBe(true);
    const text = uniqueMarker('missed');
    await send(sender, text);
    await expect(messageWithText(receiver, text)).toHaveCount(0);
    await receiverContext.setOffline(false);
    const retry = receiver.getByRole('button', { name: 'Повторить', exact: true });
    if (await retry.isVisible()) await retry.click();
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    await expect
      .poll(() =>
        receiver.evaluate(() =>
          (window as unknown as { __e2eSockets: WebSocket[] }).__e2eSockets.some(
            (socket) => socket.readyState === WebSocket.OPEN
          )
        )
      )
      .toBe(true);
    expect(sockets.every((url) => !new URL(url).searchParams.has('token'))).toBe(true);
    await expect(messageWithText(receiver, text)).toBeVisible({ timeout: 60_000 });
    expect(
      await receiver.evaluate(() => (window as unknown as { __e2eDocument: string }).__e2eDocument)
    ).toBe(documentId);
  } finally {
    await receiverContext.setOffline(false);
  }
});

test('ротация при смене состава сохраняет доступную историю и новые сообщения', async ({
  pair,
}) => {
  test.setTimeout(300_000);
  const response = await pair.senderContext.request.post('/api/v2/chats/groups', {
    headers: { Origin: new URL(pair.sender.url()).origin },
    data: { title: uniqueMarker('rotation'), members: [pair.B.user.id] },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const chatId = body.chatId ?? body.chat?.id ?? body.id;
  expect(chatId).toBeTruthy();
  const epoch = async () => {
    return pair.sender.evaluate(async (id) => {
      const response = await fetch(`/api/v2/encryption/chat-keys/${id}`);
      if (!response.ok) throw new Error(`Чтение эпохи: ${response.status}`);
      return (await response.json()).keyEpoch as number;
    }, chatId);
  };
  try {
    await openChat(pair.receiver, chatId);
    await openChat(pair.sender, chatId);
    const oldText = uniqueMarker('before-rotation');
    await send(pair.sender, oldText);
    await expect(messageWithText(pair.receiver, oldText)).toBeVisible();
    const before = await epoch();
    expect(before).toBeGreaterThan(0);
    await openChat(pair.receiver, pair.directChatId);
    const removed = await pair.senderContext.request.delete(
      `/api/v2/chats/${chatId}/members/${pair.B.user.id}`,
      {
        headers: { Origin: new URL(pair.sender.url()).origin },
      }
    );
    expect(removed.ok()).toBe(true);
    await expect.poll(epoch, { intervals: [1000, 2000], timeout: 60_000 }).toBeGreaterThan(before);
    const added = await pair.senderContext.request.post(`/api/v2/chats/${chatId}/members`, {
      headers: { Origin: new URL(pair.sender.url()).origin },
      data: { userId: pair.B.user.id },
    });
    expect(added.ok()).toBe(true);
    await openChat(pair.receiver, chatId);
    const newText = uniqueMarker('after-rotation');
    await send(pair.sender, newText);
    await expect(messageWithText(pair.receiver, newText)).toBeVisible({ timeout: 60_000 });
    await pair.receiver.reload();
    await waitForHistory(pair.receiver);
    // #707: обычная смена эпохи не уничтожает уже полученные ключи истории.
    await expect(messageWithText(pair.receiver, oldText)).toBeVisible();
    await expect(messageWithText(pair.receiver, newText)).toBeVisible({ timeout: 60_000 });
  } finally {
    await openChat(pair.receiver, pair.directChatId);
    await openChat(pair.sender, pair.directChatId);
  }
});
