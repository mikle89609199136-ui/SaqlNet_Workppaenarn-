// Frozen compatibility fixtures for #707, generated independently of app code.
// Run manually only when introducing a documented protocol version. Never
// regenerate fixtures to make incompatible changes to an existing version pass.
// All private keys, IVs and plaintext here are PUBLIC TEST DATA, not real secrets.
const {
  createECDH,
  createPrivateKey,
  createPublicKey,
  createHash,
  hkdfSync,
  createCipheriv,
  sign,
} = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const scalar = (n) => {
  const bytes = Buffer.alloc(32);
  bytes[31] = n;
  return bytes;
};
function pair(n) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(scalar(n));
  const raw = ecdh.getPublicKey();
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: scalar(n).toString('base64url'),
      x: raw.subarray(1, 33).toString('base64url'),
      y: raw.subarray(33).toString('base64url'),
    },
  });
  return {
    ecdh,
    privateKey,
    pkcs8: b64(privateKey.export({ format: 'der', type: 'pkcs8' })),
    spki: b64(createPublicKey(privateKey).export({ format: 'der', type: 'spki' })),
  };
}
function identity(accountId, dhScalar, signingScalar) {
  const dh = pair(dhScalar),
    signing = pair(signingScalar);
  const bundle = b64(JSON.stringify({ v: 2, ecdh: dh.spki, ecdsa: signing.spki }));
  return {
    accountId,
    bundle,
    fingerprint: createHash('sha256').update(bundle).digest('base64url'),
    ecdhPkcs8: dh.pkcs8,
    ecdsaPkcs8: signing.pkcs8,
  };
}
const chatId = '70700000-0000-4000-8000-000000000070';
const epoch = 7;
const sender = identity('70700000-0000-4000-8000-000000000001', 1, 3);
const recipient = identity('70700000-0000-4000-8000-000000000002', 2, 4);
const chatKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const salt = createHash('sha256').update(chatId).digest();
const derive = (ikm, info) => Buffer.from(hkdfSync('sha256', ikm, salt, info, 32));
const msgKey = derive(chatKey, 'craneapp/e2e/v2/msg');
const mediaKey = derive(chatKey, 'craneapp/e2e/v2/media');
const seal = (key, iv, plaintext, aad) => {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad));
  return b64(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
};
const context = `${chatId}|${epoch}|${sender.accountId}`;
const v2Text = 'История v2 🔒';
const v3Content = {
  text: 'Привет 👋',
  entities: [{ type: 'bold', offset: 0, length: 6 }],
  voice: { d: 1200, w: [1, 20, 31], g: 3.5 },
};
function message(v, ivHex, plaintext) {
  const iv = Buffer.from(ivHex, 'hex');
  const envelope = {
    v,
    e2e: true,
    epoch,
    iv: b64(iv),
    data: seal(msgKey, iv, Buffer.from(plaintext), v === 2 ? context : `${context}|v3`),
  };
  const signingInput = `${context}|${envelope.iv}|${envelope.data}`;
  // ECDSA uses a random nonce. The resulting signature is frozen in the fixture.
  return {
    envelope: {
      ...envelope,
      kid: sender.fingerprint,
      sig: b64(
        sign('sha256', Buffer.from(signingInput), {
          key: pair(3).privateKey,
          dsaEncoding: 'ieee-p1363',
        })
      ),
    },
    signingInput,
  };
}
const mediaIv = Buffer.from('202122232425262728292a2b', 'hex');
const mediaPlaintext = [0, 1, 2, 127, 128, 254, 255];
const wrapIv = Buffer.from('303132333435363738393a3b', 'hex');
const sharedSecret = pair(1).ecdh.computeSecret(pair(2).ecdh.getPublicKey());
const wrapKey = derive(
  sharedSecret,
  `craneapp/e2e/v2/wrap|${epoch}|${sender.fingerprint}|${recipient.fingerprint}`
);
const wrapped = {
  v: 2,
  iv: b64(wrapIv),
  ct: seal(wrapKey, wrapIv, chatKey),
  senderId: sender.accountId,
  recipientFp: recipient.fingerprint,
};
const vectors = {
  chatId,
  epoch,
  chatKey: b64(chatKey),
  sender,
  recipient,
  v2: { text: v2Text, ...message(2, '000102030405060708090a0b', v2Text) },
  v3: { content: v3Content, ...message(3, '101112131415161718191a1b', JSON.stringify(v3Content)) },
  media: {
    plaintext: mediaPlaintext,
    payload: {
      version: 2,
      encrypted: true,
      algorithm: 'AES-GCM',
      iv: b64(mediaIv),
      ciphertext: seal(mediaKey, mediaIv, Buffer.from(mediaPlaintext), `${chatId}|${epoch}`),
      mimeType: 'application/octet-stream',
      sizeBytes: mediaPlaintext.length,
      keyEpoch: epoch,
    },
  },
  wrappedKey: {
    userId: recipient.accountId,
    encryptedKey: b64(JSON.stringify(wrapped)),
    senderKeyId: sender.fingerprint,
    keyEpoch: epoch,
  },
  wrapIv: b64(wrapIv),
};
writeFileSync(
  join(__dirname, '../frontend/src/test/fixtures/e2eProtocolVectors.ts'),
  '// Frozen v2/v3 compatibility vectors. PUBLIC TEST KEYS ONLY.\n// Generated independently by scripts/generate-e2e-protocol-vectors.cjs.\n// Keep these bytes when changing implementation; new protocols need new vectors.\nexport const protocolVectors = ' +
    JSON.stringify(vectors, null, 2) +
    ';\n'
);
