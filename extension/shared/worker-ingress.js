/*
 * Keygrain encrypted unlock ingress foundation.
 *
 * This module is wired into the shipped MV3 popup/background challenge flow.
 * Runtime sender/origin/document trust is supplied by each browser adapter via
 * runtimeAdmission; caller-provided labels are never treated as trusted facts.
 * JavaScript strings, JSON copies, WebCrypto internals, and GC-managed memory
 * cannot be physically zeroized. Mutable byte buffers are cleared best effort.
 */
(function installKeygrainWorkerIngress(root) {
  'use strict';


  const METADATA_GENERATE_PROTOCOL = 'keygrain-metadata-password-generate-v1';
  const METADATA_FILL_PROTOCOL = 'keygrain-metadata-password-fill-v1';
  const METADATA_PROTOCOLS = new Set([METADATA_GENERATE_PROTOCOL, METADATA_FILL_PROTOCOL]);
  const METADATA_AAD_PREFIX = new TextEncoder().encode('KEYGRAIN-METADATA-PASSWORD-AAD-v1\0');
  const METADATA_OAEP_LABEL_TEXT = 'KEYGRAIN-METADATA-PASSWORD-OAEP-LABEL-v1';
  const METADATA_OAEP_LABEL = new TextEncoder().encode(METADATA_OAEP_LABEL_TEXT);
  const METADATA_PLAINTEXT_VERSION = 1;
  const METADATA_ID_BYTES = 32;
  const METADATA_IV_BYTES = 12;
  const METADATA_RSA_BYTES = 256;
  const METADATA_TAG_BYTES = 16;
  const METADATA_MAX_SECRET_BYTES = 4096;
  const METADATA_MAX_ENVELOPE_BYTES = 65536;
  const METADATA_TTL_MS = 30000;
  const METADATA_ENVELOPE_KEYS = [
    'protocol', 'challengeId', 'requestId', 'popupSessionNonce',
    'workerIncarnation', 'publicKeySha256', 'iv', 'wrappedKey', 'ciphertext',
  ];
  const METADATA_OUTER_KEYS = ['type', 'envelopeText'];

  function metadataFail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function metadataProtocol(value) {
    if (!METADATA_PROTOCOLS.has(value)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    return value;
  }

  function metadataPlaintext(secret) {
    const secretBytes = encodeUtf8(secret, 'SECRET_UTF8');
    if (secretBytes.length < 1 || secretBytes.length > METADATA_MAX_SECRET_BYTES) {
      clearBytes(secretBytes);
      throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    }
    const result = new Uint8Array(1 + 4 + secretBytes.length);
    result[0] = METADATA_PLAINTEXT_VERSION;
    putU32(new DataView(result.buffer), 1, secretBytes.length);
    result.set(secretBytes, 5);
    clearBytes(secretBytes);
    return result;
  }

  function metadataParsePlaintext(value) {
    const input = copyBytes(value, 'PLAINTEXT');
    try {
      if (input.length < 5 || input.length > 5 + METADATA_MAX_SECRET_BYTES
        || input[0] !== METADATA_PLAINTEXT_VERSION) throw metadataFail('INVALID_PLAINTEXT');
      const length = readU32(new DataView(input.buffer, input.byteOffset, input.byteLength), 1);
      if (length < 1 || length > METADATA_MAX_SECRET_BYTES || length + 5 !== input.length) {
        throw metadataFail('INVALID_PLAINTEXT');
      }
      return decodeUtf8(input.slice(5), 'SECRET_UTF8');
    } finally {
      clearBytes(input);
    }
  }

  function metadataBuildAAD(fields) {
    const protocol = encodeUtf8(metadataProtocol(fields && fields.protocol), 'PROTOCOL_UTF8');
    if (protocol.length > 0xffff) {
      clearBytes(protocol);
      throw metadataFail('INVALID_PROTOCOL');
    }
    const names = ['challengeId', 'requestId', 'popupSessionNonce', 'workerIncarnation'];
    const values = names.map(name => {
      const value = copyBytes(fields && fields[name], name.toUpperCase());
      if (value.length !== METADATA_ID_BYTES) {
        clearBytes(value);
        throw metadataFail(`INVALID_${name.toUpperCase()}`);
      }
      return value;
    });
    const publicKeyHash = copyBytes(fields && fields.publicKeyHash, 'PUBLIC_KEY_HASH');
    if (publicKeyHash.length !== METADATA_ID_BYTES || typeof fields?.fillEmail !== 'boolean') {
      clearBytes(publicKeyHash);
      for (const value of values) clearBytes(value);
      clearBytes(protocol);
      throw metadataFail('INVALID_METADATA_AAD');
    }
    const result = new Uint8Array(METADATA_AAD_PREFIX.length + 1 + 2 + protocol.length
      + (5 * (1 + METADATA_ID_BYTES)) + 1);
    result.set(METADATA_AAD_PREFIX, 0);
    let offset = METADATA_AAD_PREFIX.length;
    result[offset++] = METADATA_PLAINTEXT_VERSION;
    new DataView(result.buffer).setUint16(offset, protocol.length, false);
    offset += 2;
    result.set(protocol, offset);
    offset += protocol.length;
    for (const value of [...values, publicKeyHash]) {
      result[offset++] = METADATA_ID_BYTES;
      result.set(value, offset);
      offset += value.length;
      clearBytes(value);
    }
    result[offset] = fields.fillEmail ? 1 : 0;
    clearBytes(protocol);
    return result;
  }

  function metadataParseEnvelopeText(envelopeText) {
    let encodedSize;
    try { encodedSize = new TextEncoder().encode(envelopeText).byteLength; } catch (_) {
      throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    }
    if (encodedSize > METADATA_MAX_ENVELOPE_BYTES) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    const object = parseCanonicalObject(envelopeText, METADATA_ENVELOPE_KEYS, 'METADATA_ENVELOPE');
    metadataProtocol(object.protocol);
    const challengeId = fromBase64Url(object.challengeId, METADATA_ID_BYTES, 'CHALLENGE_ID');
    const requestId = fromBase64Url(object.requestId, METADATA_ID_BYTES, 'REQUEST_ID');
    const popupSessionNonce = fromBase64Url(object.popupSessionNonce, METADATA_ID_BYTES, 'SESSION_NONCE');
    const workerIncarnation = fromBase64Url(object.workerIncarnation, METADATA_ID_BYTES, 'WORKER_INCARNATION');
    const publicKeyHash = fromHex64(object.publicKeySha256);
    const iv = fromBase64Url(object.iv, METADATA_IV_BYTES, 'IV');
    const wrappedKey = fromBase64Url(object.wrappedKey, METADATA_RSA_BYTES, 'WRAPPED_KEY');
    const ciphertext = fromBase64Url(object.ciphertext, undefined, 'CIPHERTEXT');
    if (ciphertext.length < METADATA_TAG_BYTES || ciphertext.length > 5 + METADATA_MAX_SECRET_BYTES + METADATA_TAG_BYTES) {
      throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    }
    return {object, protocol: object.protocol, challengeId, requestId, popupSessionNonce,
      workerIncarnation, publicKeyHash, iv, wrappedKey, ciphertext};
  }

  function metadataParseOuterWrapper(wrapper) {
    if (!isPlainObject(wrapper)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    const keys = Object.keys(wrapper);
    if (keys.length !== METADATA_OUTER_KEYS.length || keys.some((key, index) => key !== METADATA_OUTER_KEYS[index])
      || !isDataProperty(wrapper, 'type') || !isDataProperty(wrapper, 'envelopeText')
      || wrapper.type !== 'METADATA_PASSWORD' || typeof wrapper.envelopeText !== 'string') {
      throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    }
    return metadataParseEnvelopeText(wrapper.envelopeText);
  }

  function metadataPublicChallenge(record) {
    return Object.freeze({
      protocol: record.protocol,
      challengeId: toBase64Url(record.challengeId),
      requestId: toBase64Url(record.requestId),
      popupSessionNonce: toBase64Url(record.popupSessionNonce),
      workerIncarnation: toBase64Url(record.workerIncarnation),
      publicKeySpki: toBase64Url(record.publicKeySpki),
      publicKeySha256: record.publicKeySha256,
    });
  }

  async function makeMetadataEnvelope(challenge, secret, options) {
    const crypto = getCrypto(options && options.crypto);
    if (!crypto || !crypto.subtle || !challenge || !METADATA_PROTOCOLS.has(challenge.protocol)) {
      throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
    }
    const protocol = challenge.protocol;
    let challengeId;
    let requestId;
    let popupSessionNonce;
    let workerIncarnation;
    let publicKeySpki;
    let publicKeyHash;
    let actualHash;
    let plaintext;
    let iv;
    let aesKeyBytes;
    let aad;
    let ciphertext;
    let wrappedKey;
    try {
      challengeId = fromBase64Url(challenge.challengeId, METADATA_ID_BYTES, 'CHALLENGE_ID');
      requestId = fromBase64Url(challenge.requestId, METADATA_ID_BYTES, 'REQUEST_ID');
      popupSessionNonce = fromBase64Url(challenge.popupSessionNonce, METADATA_ID_BYTES, 'SESSION_NONCE');
      workerIncarnation = fromBase64Url(challenge.workerIncarnation, METADATA_ID_BYTES, 'WORKER_INCARNATION');
      publicKeySpki = fromBase64Url(challenge.publicKeySpki, undefined, 'PUBLIC_KEY_SPKI');
      publicKeyHash = fromHex64(challenge.publicKeySha256);
      actualHash = await sha256(crypto, publicKeySpki);
      if (!equalBytes(actualHash, publicKeyHash)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      plaintext = metadataPlaintext(secret);
      iv = options && options.iv ? copyBytes(options.iv, 'IV') : randomBytes(crypto, METADATA_IV_BYTES);
      aesKeyBytes = options && options.aesKey ? copyBytes(options.aesKey, 'AES_KEY') : randomBytes(crypto, 32);
      if (iv.length !== METADATA_IV_BYTES || aesKeyBytes.length !== 32) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      aad = metadataBuildAAD({protocol, challengeId, requestId, popupSessionNonce, workerIncarnation,
        publicKeyHash, fillEmail: protocol === METADATA_FILL_PROTOCOL});
      const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
      ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad, tagLength: 128}, aesKey, plaintext));
      const rsaPublic = await crypto.subtle.importKey('spki', publicKeySpki, {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
      wrappedKey = new Uint8Array(await crypto.subtle.encrypt({name: 'RSA-OAEP', label: METADATA_OAEP_LABEL}, rsaPublic, aesKeyBytes));
      const envelopeText = JSON.stringify({protocol, challengeId: toBase64Url(challengeId), requestId: toBase64Url(requestId),
        popupSessionNonce: toBase64Url(popupSessionNonce), workerIncarnation: toBase64Url(workerIncarnation),
        publicKeySha256: challenge.publicKeySha256, iv: toBase64Url(iv), wrappedKey: toBase64Url(wrappedKey),
        ciphertext: toBase64Url(ciphertext)});
      if (new TextEncoder().encode(envelopeText).byteLength > METADATA_MAX_ENVELOPE_BYTES) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      return {type: 'METADATA_PASSWORD', envelopeText};
    } finally {
      clearBytes(plaintext); clearBytes(iv); clearBytes(aesKeyBytes); clearBytes(aad);
      clearBytes(ciphertext); clearBytes(wrappedKey); clearBytes(publicKeySpki); clearBytes(actualHash);
      clearBytes(challengeId); clearBytes(requestId); clearBytes(popupSessionNonce); clearBytes(workerIncarnation); clearBytes(publicKeyHash);
    }
  }

  async function createMetadataPasswordIngress(options) {
    const settings = options || {};
    const crypto = getCrypto(settings.crypto);
    if (!crypto || !crypto.subtle) throw metadataFail('CRYPTO_UNAVAILABLE');
    const runtimeAdmission = settings.runtimeAdmission;
    if (!runtimeAdmission || typeof runtimeAdmission.issue !== 'function' || typeof runtimeAdmission.admit !== 'function') {
      throw metadataFail('RUNTIME_ADMISSION_REQUIRED');
    }
    if (typeof settings.onMetadataSecret !== 'function') throw metadataFail('PRIVATE_METADATA_SINK_REQUIRED');
    const clock = settings.clock || (() => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()));
    const records = new Map();
    const workerIncarnation = randomBytes(crypto, METADATA_ID_BYTES);
    let closed = false;
    let epoch = 0;
    let lastClock = null;

    function clockNow() {
      let value;
      try { value = clock(); } catch (_) { value = NaN; }
      if (typeof value !== 'number' || !Number.isFinite(value) || (lastClock !== null && value < lastClock)) {
        revokeAll();
        return null;
      }
      lastClock = value;
      return value;
    }

    function clearRecord(record) {
      if (!record) return;
      record.state = 'CONSUMED';
      clearBytes(record.challengeId); clearBytes(record.requestId); clearBytes(record.popupSessionNonce);
      clearBytes(record.workerIncarnation); clearBytes(record.publicKeySpki); clearBytes(record.publicKeyHashBytes);
      record.privateKey = null; record.selectionBinding = null;
    }

    function cloneSelectionBinding(value, seen = new WeakSet(), depth = 0) {
      if (value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))) return value;
      if (depth > 16 || typeof value !== 'object' || seen.has(value)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      const prototype = Object.getPrototypeOf(value);
      const prototypeConstructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor');
      const isDefaultPrototype = prototype === null || (prototypeConstructor && 'value' in prototypeConstructor
        && prototypeConstructor.value && prototypeConstructor.value.name === (Array.isArray(value) ? 'Array' : 'Object')
        && Object.getPrototypeOf(prototype) === (Array.isArray(value) ? Object.getPrototypeOf(prototypeConstructor.value.prototype) : null));
      if (!isDefaultPrototype) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      seen.add(value);
      const result = Array.isArray(value) ? [] : {};
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || key === '__proto__') throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
        Object.defineProperty(result, key, {value: cloneSelectionBinding(descriptor.value, seen, depth + 1), enumerable: true, writable: true, configurable: true});
      }
      seen.delete(value);
      return Object.freeze(result);
    }

    async function issueChallenge({runtimeContext, purpose, selectionBinding, fillEmail} = {}) {
      if (closed || !METADATA_PROTOCOLS.has(purpose) || !selectionBinding || typeof fillEmail !== 'boolean'
        || (purpose === METADATA_GENERATE_PROTOCOL && fillEmail !== false)) throw metadataFail('KEYGRAIN_AUTH_PROTOCOL_ERROR');
      const privateSelectionBinding = cloneSelectionBinding(selectionBinding);
      const issueEpoch = epoch;
      const issuedAt = clockNow();
      if (issuedAt === null) throw metadataFail('KEYGRAIN_STALE_OPERATION');
      let challengeId;
      let requestId;
      let popupSessionNonce;
      let keyPair = null;
      let publicKeySpki;
      let publicKeyHashBytes;
      let record = null;
      let registered = false;
      try {
        challengeId = randomBytes(crypto, METADATA_ID_BYTES);
        requestId = randomBytes(crypto, METADATA_ID_BYTES);
        popupSessionNonce = randomBytes(crypto, METADATA_ID_BYTES);
        keyPair = await crypto.subtle.generateKey(
          {name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
          false, ['encrypt', 'decrypt']);
        publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
        publicKeyHashBytes = await sha256(crypto, publicKeySpki);
        const publicKeySha256 = toHex(publicKeyHashBytes);
        record = {protocol: purpose, challengeId, requestId, popupSessionNonce,
          workerIncarnation: workerIncarnation.slice(), privateKey: keyPair.privateKey, publicKeySpki,
          publicKeyHashBytes, publicKeySha256, fillEmail, selectionBinding: privateSelectionBinding, state: 'ISSUED',
          issuedAt, expiresAt: issuedAt + METADATA_TTL_MS};
        const publicChallenge = metadataPublicChallenge(record);
        let accepted = false;
        try { accepted = runtimeAdmission.issue({runtimeContext, challenge: publicChallenge, purpose}) === true; } catch (_) { accepted = false; }
        if (!accepted || closed || epoch !== issueEpoch) throw metadataFail('KEYGRAIN_CONTEXT_ERROR');
        const key = `${purpose}:${toBase64Url(record.challengeId)}`;
        records.set(key, record);
        registered = true;
        return publicChallenge;
      } finally {
        if (!registered) {
          if (record) clearRecord(record);
          else if (keyPair) keyPair.privateKey = null;
          clearBytes(challengeId); clearBytes(requestId); clearBytes(popupSessionNonce);
          clearBytes(publicKeySpki); clearBytes(publicKeyHashBytes);
        }
      }
    }

    async function admitMetadataPassword({runtimeContext, envelope} = {}) {
      let parsed;
      try { parsed = metadataParseOuterWrapper(envelope); }
      catch (_) { return {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR'}; }
      const key = `${parsed.protocol}:${toBase64Url(parsed.challengeId)}`;
      const record = records.get(key);
      if (!record || record.state !== 'ISSUED') return {ok: false, code: 'KEYGRAIN_STALE_OPERATION'};
      const now = clockNow();
      if (now === null || now >= record.expiresAt) {
        records.delete(key); clearRecord(record);
        return {ok: false, code: 'KEYGRAIN_STALE_OPERATION'};
      }
      const bindingMatches = equalBytes(parsed.requestId, record.requestId)
        && equalBytes(parsed.popupSessionNonce, record.popupSessionNonce)
        && equalBytes(parsed.workerIncarnation, record.workerIncarnation)
        && parsed.object.publicKeySha256 === record.publicKeySha256
        && equalBytes(parsed.publicKeyHash, record.publicKeyHashBytes)
        && parsed.protocol === record.protocol;
      if (!bindingMatches) {
        records.delete(key); clearRecord(record);
        return {ok: false, code: 'KEYGRAIN_STALE_OPERATION'};
      }
      let runtimeAccepted = false;
      try { runtimeAccepted = runtimeAdmission.admit({runtimeContext, challenge: metadataPublicChallenge(record), envelope: parsed.object, purpose: record.protocol}) === true; } catch (_) { runtimeAccepted = false; }
      if (!runtimeAccepted) return {ok: false, code: 'KEYGRAIN_CONTEXT_ERROR'};
      // Compare-and-set before the first decrypt await. Every admitted attempt
      // is single-use, including wrong-secret, malformed-plaintext, timeout,
      // callback, and delivery failures.
      records.delete(key);
      record.state = 'ADMITTED';
      const admissionEpoch = epoch;
      const assertCurrent = () => {
        if (closed || epoch !== admissionEpoch || record.state !== 'ADMITTED') throw metadataFail('KEYGRAIN_STALE_OPERATION');
      };
      let plaintext;
      let aesKeyBytes;
      let aad;
      let secret = null;
      try {
        const decryptedKey = await crypto.subtle.decrypt({name: 'RSA-OAEP', label: METADATA_OAEP_LABEL}, record.privateKey, parsed.wrappedKey);
        assertCurrent();
        aesKeyBytes = new Uint8Array(decryptedKey);
        if (aesKeyBytes.length !== 32) throw metadataFail('KEYGRAIN_UNLOCK_FAILED');
        const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
        assertCurrent();
        aad = metadataBuildAAD({protocol: record.protocol, challengeId: record.challengeId, requestId: record.requestId,
          popupSessionNonce: record.popupSessionNonce, workerIncarnation: record.workerIncarnation,
          publicKeyHash: record.publicKeyHashBytes, fillEmail: record.fillEmail});
        plaintext = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: parsed.iv, additionalData: aad, tagLength: 128}, aesKey, parsed.ciphertext));
        assertCurrent();
        secret = metadataParsePlaintext(plaintext);
        assertCurrent();
        const result = await settings.onMetadataSecret({purpose: record.protocol, fillEmail: record.fillEmail,
          selectionBinding: record.selectionBinding, secret, runtimeContext});
        assertCurrent();
        if (!result || typeof result !== 'object' || Array.isArray(result)) return {ok: false, code: 'KEYGRAIN_OPERATION_ERROR'};
        return result;
      } catch (exception) {
        if (exception?.code === 'KEYGRAIN_STALE_OPERATION') return {ok: false, code: 'KEYGRAIN_STALE_OPERATION'};
        if (exception?.code === 'KEYGRAIN_AUTH_PROTOCOL_ERROR') return {ok: false, code: 'KEYGRAIN_AUTH_PROTOCOL_ERROR'};
        if (exception?.code === 'KEYGRAIN_UNLOCK_FAILED') return {ok: false, code: 'KEYGRAIN_UNLOCK_FAILED'};
        return {ok: false, code: 'KEYGRAIN_UNLOCK_FAILED'};
      } finally {
        secret = null;
        clearBytes(plaintext); clearBytes(aesKeyBytes); clearBytes(aad);
        clearRecord(record);
      }
    }

    function revokeAll() {
      closed = true;
      epoch++;
      for (const record of records.values()) clearRecord(record);
      records.clear();
      clearBytes(workerIncarnation);
    }

    return Object.freeze({issueChallenge, admitMetadataPassword, revokeAll});
  }

  const PROTOCOL = 'keygrain-unlock-ingress-v1';
  const VERSION = 1;
  const OAEP_LABEL_TEXT = 'KEYGRAIN-RSA-OAEP-LABEL-v1';
  const OAEP_LABEL = new TextEncoder().encode(OAEP_LABEL_TEXT);
  const AAD_PREFIX = new TextEncoder().encode('KEYGRAIN-INGRESS-AAD-v1\0');
  const ID_BYTES = 32;
  const IV_BYTES = 12;
  const RSA_BYTES = 256;
  const TAG_BYTES = 16;
  const MAX_EMAIL_BYTES = 254;
  const MAX_SECRET_BYTES = 4096;
  const MAX_PLAINTEXT_BYTES = 1 + 4 + MAX_EMAIL_BYTES + 4 + MAX_SECRET_BYTES;
  const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + TAG_BYTES;
  const B64URL = /^[A-Za-z0-9_-]*$/;
  const HEX64 = /^[0-9a-f]{64}$/;
  const ENVELOPE_KEYS = [
    'protocol', 'challengeId', 'requestId', 'popupSessionNonce',
    'workerIncarnation', 'publicKeySha256', 'iv', 'wrappedKey', 'ciphertext',
  ];
  const OUTER_KEYS = ['type', 'envelopeText'];

  const getCrypto = supplied => supplied || root.crypto;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function clearBytes(value) {
    if (value instanceof Uint8Array) value.fill(0);
  }

  function bytes(value, name) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw fail(`INVALID_${name || 'BYTES'}`);
  }

  function copyBytes(value, name) {
    return new Uint8Array(bytes(value, name));
  }

  function equalBytes(a, b) {
    const left = bytes(a);
    const right = bytes(b);
    if (left.byteLength !== right.byteLength) return false;
    let different = 0;
    for (let i = 0; i < left.byteLength; i++) different |= left[i] ^ right[i];
    return different === 0;
  }

  function randomBytes(crypto, length) {
    if (!crypto || typeof crypto.getRandomValues !== 'function') throw fail('CRYPTO_UNAVAILABLE');
    const result = new Uint8Array(length);
    crypto.getRandomValues(result);
    return result;
  }

  function toBase64Url(value) {
    const input = bytes(value);
    let binary = '';
    for (const byte of input) binary += String.fromCharCode(byte);
    const encoded = typeof root.btoa === 'function'
      ? root.btoa(binary)
      : (typeof Buffer !== 'undefined' ? Buffer.from(input).toString('base64') : null);
    if (encoded === null) throw fail('BASE64_UNAVAILABLE');
    return encoded.replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_');
  }

  function fromBase64Url(value, expectedLength, name) {
    if (typeof value !== 'string' || !B64URL.test(value) || value.length % 4 === 1) {
      throw fail(`INVALID_${name || 'BASE64URL'}`);
    }
    if (expectedLength !== undefined) {
      const expectedChars = Math.ceil(expectedLength / 3) * 4;
      const maxChars = expectedChars - (expectedLength % 3 === 0 ? 0 : 3 - (expectedLength % 3));
      if (value.length !== maxChars) throw fail(`INVALID_${name || 'BASE64URL'}_LENGTH`);
    }
    const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
    const result = new Uint8Array(Math.floor((padded.length * 3) / 4) - (padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0));
    let accumulator = 0;
    let bits = 0;
    let offset = 0;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const character of value) {
      const digit = alphabet.indexOf(character);
      accumulator = (accumulator << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        result[offset++] = (accumulator >>> bits) & 0xff;
      }
    }
    if (offset !== result.length || (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0)) {
      throw fail(`INVALID_${name || 'BASE64URL'}`);
    }
    if (toBase64Url(result) !== value) throw fail(`INVALID_${name || 'BASE64URL'}`);
    return result;
  }

  function toHex(value) {
    return Array.from(bytes(value), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function fromHex64(value) {
    if (typeof value !== 'string' || !HEX64.test(value)) throw fail('INVALID_PUBLIC_KEY_HASH');
    const result = new Uint8Array(32);
    for (let i = 0; i < result.length; i++) result[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return result;
  }

  function hasUnpairedSurrogate(value) {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next < 0xdc00 || next > 0xdfff) return true;
        i++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }
    }
    return false;
  }

  function encodeUtf8(value, name) {
    if (typeof value !== 'string' || hasUnpairedSurrogate(value)) throw fail(`INVALID_${name || 'UTF8'}`);
    return new TextEncoder().encode(value);
  }

  function decodeUtf8(value, name) {
    const input = copyBytes(value, name || 'UTF8');
    let decoded;
    try {
      decoded = new TextDecoder('utf-8', {fatal: true}).decode(input);
    } catch {
      clearBytes(input);
      throw fail(`INVALID_${name || 'UTF8'}`);
    }
    if (!equalBytes(new TextEncoder().encode(decoded), input)) {
      clearBytes(input);
      throw fail(`INVALID_${name || 'UTF8'}`);
    }
    clearBytes(input);
    return decoded;
  }

  function putU32(view, offset, value) {
    view.setUint32(offset, value, false);
  }

  function buildPlaintext(email, secret) {
    const emailBytes = encodeUtf8(email, 'EMAIL_UTF8');
    const secretBytes = encodeUtf8(secret, 'SECRET_UTF8');
    if (emailBytes.length > MAX_EMAIL_BYTES) throw fail('EMAIL_TOO_LONG');
    if (secretBytes.length < 1 || secretBytes.length > MAX_SECRET_BYTES) throw fail('SECRET_LENGTH');
    const result = new Uint8Array(1 + 4 + emailBytes.length + 4 + secretBytes.length);
    result[0] = VERSION;
    const view = new DataView(result.buffer);
    putU32(view, 1, emailBytes.length);
    result.set(emailBytes, 5);
    const secretOffset = 5 + emailBytes.length;
    putU32(view, secretOffset, secretBytes.length);
    result.set(secretBytes, secretOffset + 4);
    clearBytes(emailBytes);
    clearBytes(secretBytes);
    return result;
  }

  function readU32(view, offset) {
    return view.getUint32(offset, false);
  }

  function parsePlaintext(value) {
    const input = copyBytes(value, 'PLAINTEXT');
    try {
      if (input.length < 1 + 4 + 4 || input.length > MAX_PLAINTEXT_BYTES || input[0] !== VERSION) throw fail('INVALID_PLAINTEXT');
      const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const emailLength = readU32(view, 1);
      if (emailLength > MAX_EMAIL_BYTES) throw fail('INVALID_EMAIL_LENGTH');
      const secretLengthOffset = 5 + emailLength;
      if (secretLengthOffset + 4 > input.length) throw fail('INVALID_PLAINTEXT');
      const secretLength = readU32(view, secretLengthOffset);
      if (secretLength < 1 || secretLength > MAX_SECRET_BYTES) throw fail('INVALID_SECRET_LENGTH');
      const end = secretLengthOffset + 4 + secretLength;
      if (end !== input.length) throw fail('INVALID_PLAINTEXT_TRAILING_BYTES');
      const emailBytes = input.slice(5, secretLengthOffset);
      const secretBytes = input.slice(secretLengthOffset + 4, end);
      const email = decodeUtf8(emailBytes, 'EMAIL_UTF8');
      const secret = decodeUtf8(secretBytes, 'SECRET_UTF8');
      clearBytes(emailBytes);
      clearBytes(secretBytes);
      return {version: VERSION, email, secret};
    } finally {
      clearBytes(input);
    }
  }

  function buildAAD(fields) {
    const names = ['challengeId', 'requestId', 'popupSessionNonce', 'workerIncarnation'];
    const values = names.map(name => {
      const result = copyBytes(fields && fields[name], name.toUpperCase());
      if (result.length !== ID_BYTES) {
        clearBytes(result);
        throw fail(`INVALID_${name.toUpperCase()}`);
      }
      return result;
    });
    const publicKeyHash = fields && fields.publicKeyHash instanceof Uint8Array
      ? copyBytes(fields.publicKeyHash, 'PUBLIC_KEY_HASH')
      : fromHex64(fields && fields.publicKeySha256);
    if (publicKeyHash.length !== ID_BYTES) throw fail('INVALID_PUBLIC_KEY_HASH');
    const result = new Uint8Array(AAD_PREFIX.length + 1 + (5 * (1 + ID_BYTES)));
    result.set(AAD_PREFIX, 0);
    result[AAD_PREFIX.length] = VERSION;
    let offset = AAD_PREFIX.length + 1;
    for (const value of [...values, publicKeyHash]) {
      result[offset++] = ID_BYTES;
      result.set(value, offset);
      offset += ID_BYTES;
      clearBytes(value);
    }
    return result;
  }

  function isDataProperty(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable && descriptor.configurable && descriptor.writable);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || (typeof proto === 'object' && Object.getPrototypeOf(proto) === null);
  }

  function parseCanonicalObject(text, keys, label) {
    if (typeof text !== 'string' || text.length === 0) throw fail(`INVALID_${label}`);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw fail(`INVALID_${label}`);
    }
    if (!isPlainObject(parsed)) {
      throw fail(`INVALID_${label}`);
    }
    const actualKeys = Object.keys(parsed);
    if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) {
      throw fail(`INVALID_${label}_SCHEMA`);
    }
    const canonical = {};
    for (const key of keys) {
      if (!isDataProperty(parsed, key)) throw fail(`INVALID_${label}_PROPERTY`);
      canonical[key] = parsed[key];
    }
    if (JSON.stringify(canonical) !== text) throw fail(`INVALID_${label}_CANONICAL`);
    return canonical;
  }

  function parseEnvelopeText(envelopeText) {
    const object = parseCanonicalObject(envelopeText, ENVELOPE_KEYS, 'ENVELOPE');
    if (object.protocol !== PROTOCOL) throw fail('INVALID_PROTOCOL');
    const challengeId = fromBase64Url(object.challengeId, ID_BYTES, 'CHALLENGE_ID');
    const requestId = fromBase64Url(object.requestId, ID_BYTES, 'REQUEST_ID');
    const popupSessionNonce = fromBase64Url(object.popupSessionNonce, ID_BYTES, 'SESSION_NONCE');
    const workerIncarnation = fromBase64Url(object.workerIncarnation, ID_BYTES, 'WORKER_INCAR NATION'.replace(' ', '_'));
    const publicKeyHash = fromHex64(object.publicKeySha256);
    const iv = fromBase64Url(object.iv, IV_BYTES, 'IV');
    const wrappedKey = fromBase64Url(object.wrappedKey, RSA_BYTES, 'WRAPPED_KEY');
    const ciphertext = fromBase64Url(object.ciphertext, undefined, 'CIPHERTEXT');
    if (ciphertext.length < TAG_BYTES || ciphertext.length > MAX_CIPHERTEXT_BYTES) throw fail('INVALID_CIPHERTEXT_LENGTH');
    return {object, challengeId, requestId, popupSessionNonce, workerIncarnation, publicKeyHash, iv, wrappedKey, ciphertext};
  }

  function parseOuterWrapper(wrapper) {
    if (!isPlainObject(wrapper)) throw fail('INVALID_OUTER_WRAPPER');
    const keys = Object.keys(wrapper);
    if (keys.length !== OUTER_KEYS.length || keys.some((key, index) => key !== OUTER_KEYS[index])) throw fail('INVALID_OUTER_WRAPPER_SCHEMA');
    for (const key of OUTER_KEYS) if (!isDataProperty(wrapper, key)) throw fail('INVALID_OUTER_WRAPPER_PROPERTY');
    if (wrapper.type !== 'ENCRYPTED_UNLOCK' || typeof wrapper.envelopeText !== 'string') throw fail('INVALID_OUTER_WRAPPER');
    return parseEnvelopeText(wrapper.envelopeText);
  }

  function publicChallenge(record) {
    return Object.freeze({
      protocol: PROTOCOL,
      challengeId: toBase64Url(record.challengeId),
      requestId: toBase64Url(record.requestId),
      popupSessionNonce: toBase64Url(record.popupSessionNonce),
      workerIncarnation: toBase64Url(record.workerIncarnation),
      publicKeySpki: toBase64Url(record.publicKeySpki),
      publicKeySha256: record.publicKeySha256,
    });
  }

  async function sha256(crypto, value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)));
  }

  async function makeEnvelope(challenge, email, secret, options) {
    const crypto = getCrypto(options && options.crypto);
    if (!challenge || challenge.protocol !== PROTOCOL) throw fail('INVALID_CHALLENGE');
    const challengeId = fromBase64Url(challenge.challengeId, ID_BYTES, 'CHALLENGE_ID');
    const requestId = fromBase64Url(challenge.requestId, ID_BYTES, 'REQUEST_ID');
    const popupSessionNonce = fromBase64Url(challenge.popupSessionNonce, ID_BYTES, 'SESSION_NONCE');
    const workerIncarnation = fromBase64Url(challenge.workerIncarnation, ID_BYTES, 'WORKER_INCARNATION');
    const publicKeySpki = fromBase64Url(challenge.publicKeySpki, undefined, 'PUBLIC_KEY_SPKI');
    const publicKeyHash = fromHex64(challenge.publicKeySha256);
    const actualHash = await sha256(crypto, publicKeySpki);
    if (!equalBytes(actualHash, publicKeyHash)) throw fail('PUBLIC_KEY_HASH_MISMATCH');
    const plaintext = buildPlaintext(email, secret);
    const iv = options && options.iv ? copyBytes(options.iv, 'IV') : randomBytes(crypto, IV_BYTES);
    if (iv.length !== IV_BYTES) throw fail('INVALID_IV_LENGTH');
    const aesKeyBytes = options && options.aesKey ? copyBytes(options.aesKey, 'AES_KEY') : randomBytes(crypto, 32);
    if (aesKeyBytes.length !== 32) throw fail('INVALID_AES_KEY_LENGTH');
    const aad = buildAAD({challengeId, requestId, popupSessionNonce, workerIncarnation, publicKeyHash});
    const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad, tagLength: 128}, aesKey, plaintext));
    const rsaPublic = await crypto.subtle.importKey('spki', publicKeySpki, {name: 'RSA-OAEP', hash: 'SHA-256'}, false, ['encrypt']);
    const wrappedKey = new Uint8Array(await crypto.subtle.encrypt({name: 'RSA-OAEP', label: OAEP_LABEL}, rsaPublic, aesKeyBytes));
    clearBytes(plaintext);
    clearBytes(aesKeyBytes);
    clearBytes(aad);
    clearBytes(publicKeySpki);
    clearBytes(actualHash);
    return {
      type: 'ENCRYPTED_UNLOCK',
      envelopeText: JSON.stringify({
        protocol: PROTOCOL,
        challengeId: toBase64Url(challengeId),
        requestId: toBase64Url(requestId),
        popupSessionNonce: toBase64Url(popupSessionNonce),
        workerIncarnation: toBase64Url(workerIncarnation),
        publicKeySha256: challenge.publicKeySha256,
        iv: toBase64Url(iv),
        wrappedKey: toBase64Url(wrappedKey),
        ciphertext: toBase64Url(ciphertext),
      }),
    };
  }

  async function createIngress(options) {
    const settings = options || {};
    const crypto = getCrypto(settings.crypto);
    if (!crypto || !crypto.subtle) throw fail('CRYPTO_UNAVAILABLE');
    const runtimeAdmission = settings.runtimeAdmission;
    if (!runtimeAdmission || typeof runtimeAdmission.issue !== 'function' || typeof runtimeAdmission.admit !== 'function') throw fail('RUNTIME_ADMISSION_REQUIRED');
    if (typeof settings.onAuthenticatedUnlock !== 'function') throw fail('PRIVATE_UNLOCK_SINK_REQUIRED');
    const clock = settings.clock || (() => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()));
    const diagnostics = typeof settings.onDiagnostic === 'function' ? settings.onDiagnostic : () => {};
    const records = new Map();
    const workerIncarnation = randomBytes(crypto, ID_BYTES);
    let closed = false;
    let epoch = 0;
    let lastClock = null;

    function diagnostic(code) {
      try { diagnostics(code); } catch { /* diagnostics are non-authoritative */ }
    }

    function clockNow() {
      let value;
      try { value = clock(); } catch {
        diagnostic('CLOCK_INVALID');
        revokeAll();
        return null;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || (lastClock !== null && value < lastClock)) {
        diagnostic('CLOCK_INVALID');
        revokeAll();
        return null;
      }
      lastClock = value;
      return value;
    }

    async function issueChallenge(runtimeContext) {
      if (closed) throw fail('INGRESS_REVOKED');
      const issueEpoch = epoch;
      const issuedAt = clockNow();
      if (issuedAt === null) throw fail('CLOCK_INVALID');
      const challengeId = randomBytes(crypto, ID_BYTES);
      const requestId = randomBytes(crypto, ID_BYTES);
      const popupSessionNonce = randomBytes(crypto, ID_BYTES);
      const keyPair = await crypto.subtle.generateKey(
        {name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
        false,
        ['encrypt', 'decrypt'],
      );
      const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
      const publicKeyHashBytes = await sha256(crypto, publicKeySpki);
      const publicKeySha256 = toHex(publicKeyHashBytes);
      if (closed || epoch !== issueEpoch) {
        clearBytes(publicKeySpki); clearBytes(publicKeyHashBytes);
        throw fail('INGRESS_REVOKED');
      }
      const deadlineBase = clockNow();
      if (deadlineBase === null) throw fail('CLOCK_INVALID');
      const record = {
        protocol: PROTOCOL, challengeId, requestId, popupSessionNonce, workerIncarnation: workerIncarnation.slice(),
        privateKey: keyPair.privateKey, publicKeySpki, publicKeyHashBytes,
        publicKeySha256, state: 'ISSUED', issuedAt, expiresAt: deadlineBase + 30000,
      };
      let accepted = false;
      try {
        accepted = runtimeAdmission.issue({runtimeContext, challenge: publicChallenge(record)}) === true;
      } catch {
        accepted = false;
      }
      if (!accepted || closed || epoch !== issueEpoch || !Number.isFinite(record.issuedAt) || !Number.isFinite(record.expiresAt)) {
        record.state = 'REVOKED';
        clearBytes(record.challengeId); clearBytes(record.requestId); clearBytes(record.popupSessionNonce);
        clearBytes(record.workerIncarnation); clearBytes(record.publicKeySpki); clearBytes(record.publicKeyHashBytes);
        diagnostic('ISSUE_REJECTED');
        throw fail('RUNTIME_ADMISSION_REJECTED');
      }
      records.set(toBase64Url(record.challengeId), record);
      diagnostic('CHALLENGE_ISSUED');
      return publicChallenge(record);
    }

    function findRecord(parsed) {
      const key = toBase64Url(parsed.challengeId);
      return records.get(key) || null;
    }

    async function admitUnlock(runtimeContext, wrapper) {
      let parsed;
      try {
        parsed = parseOuterWrapper(wrapper);
      } catch {
        diagnostic('MALFORMED_REJECTED');
        return {ok: false, code: 'UNLOCK_FAILED'};
      }
      const record = findRecord(parsed);
      if (!record || record.state !== 'ISSUED') {
        diagnostic('REPLAY_REJECTED');
        return {ok: false, code: 'UNLOCK_FAILED'};
      }
      const now = clockNow();
      if (now === null) return {ok: false, code: 'UNLOCK_FAILED'};
      if (record.state !== 'ISSUED' || now >= record.expiresAt) {
        record.state = 'EXPIRED';
        diagnostic('EXPIRED_REJECTED');
        return {ok: false, code: 'UNLOCK_FAILED'};
      }
      if (!equalBytes(parsed.requestId, record.requestId) ||
          !equalBytes(parsed.popupSessionNonce, record.popupSessionNonce) ||
          !equalBytes(parsed.workerIncarnation, record.workerIncarnation) ||
          parsed.object.publicKeySha256 !== record.publicKeySha256 ||
          !equalBytes(parsed.publicKeyHash, record.publicKeyHashBytes)) {
        diagnostic('BINDING_REJECTED');
        return {ok: false, code: 'UNLOCK_FAILED'};
      }
      let runtimeAccepted = false;
      try {
        runtimeAccepted = runtimeAdmission.admit({runtimeContext, challenge: publicChallenge(record), envelope: parsed.object}) === true;
      } catch {
        runtimeAccepted = false;
      }
      if (!runtimeAccepted) {
        diagnostic('RUNTIME_REJECTED');
        return {ok: false, code: 'UNLOCK_FAILED'};
      }
      const admissionEpoch = epoch;
      // This synchronous state write is the compare-and-set before the first await.
      record.state = 'ADMITTED';
      const assertCurrent = () => {
        if (epoch !== admissionEpoch || closed || record.state !== 'ADMITTED') throw fail('STALE_ADMISSION');
      };
      diagnostic('CHALLENGE_ADMITTED');
      let plaintext;
      let aesKeyBytes;
      let aad;
      try {
        const cryptoKey = await crypto.subtle.decrypt({name: 'RSA-OAEP', label: OAEP_LABEL}, record.privateKey, parsed.wrappedKey);
        assertCurrent();
        aesKeyBytes = new Uint8Array(cryptoKey);
        if (aesKeyBytes.length !== 32) throw fail('INVALID_AES_KEY_LENGTH');
        const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
        assertCurrent();
        aad = buildAAD({challengeId: record.challengeId, requestId: record.requestId, popupSessionNonce: record.popupSessionNonce, workerIncarnation: record.workerIncarnation, publicKeyHash: record.publicKeyHashBytes});
        plaintext = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: parsed.iv, additionalData: aad, tagLength: 128}, aesKey, parsed.ciphertext));
        assertCurrent();
        const decoded = parsePlaintext(plaintext);
        const accepted = await settings.onAuthenticatedUnlock(decoded.email, decoded.secret, runtimeContext);
        assertCurrent();
        if (accepted === false) {
          throw fail('UNLOCK_FAILED');
        }
        if (typeof accepted === "object" && accepted !== null && accepted.ok === false) {
          return accepted;
        }
        diagnostic('UNLOCK_ACCEPTED');
        return {ok: true};
      } catch (err) {
        diagnostic('UNLOCK_FAILED');
        if (err && typeof err === "object" && err.ok === false) return err;
        return {ok: false, code: 'UNLOCK_FAILED'};
      } finally {
        if (record.state === 'ADMITTED') {
          record.state = 'CONSUMED';
          diagnostic('CHALLENGE_CONSUMED');
        }
        clearBytes(plaintext); clearBytes(aesKeyBytes); clearBytes(aad);
        records.delete(toBase64Url(record.challengeId));
      }
    }

    function revokeAll() {
      closed = true;
      epoch++;
      for (const record of records.values()) {
        record.state = 'REVOKED';
        clearBytes(record.challengeId); clearBytes(record.requestId); clearBytes(record.popupSessionNonce);
        clearBytes(record.workerIncarnation); clearBytes(record.publicKeySpki); clearBytes(record.publicKeyHashBytes);
      }
      clearBytes(workerIncarnation);
      records.clear();
      diagnostic('ALL_REVOKED');
    }

    return Object.freeze({issueChallenge, admitUnlock, revokeAll});
  }

  root.KeygrainWorkerIngress = Object.freeze({
    PROTOCOL,
    VERSION,
    OAEP_LABEL_TEXT,
    constants: Object.freeze({ID_BYTES, IV_BYTES, RSA_BYTES, TAG_BYTES, MAX_EMAIL_BYTES, MAX_SECRET_BYTES}),
    toBase64Url,
    fromBase64Url,
    toHex,
    fromHex64,
    buildPlaintext,
    parsePlaintext,
    buildAAD,
    parseEnvelopeText,
    parseOuterWrapper,
    makeEnvelope,
    METADATA_GENERATE_PROTOCOL,
    METADATA_FILL_PROTOCOL,
    METADATA_OAEP_LABEL_TEXT,
    METADATA_MAX_SECRET_BYTES,
    METADATA_MAX_ENVELOPE_BYTES,
    METADATA_TTL_MS,
    metadataPlaintext,
    metadataParsePlaintext,
    metadataBuildAAD,
    metadataParseEnvelopeText,
    metadataParseOuterWrapper,
    makeMetadataEnvelope,
    createMetadataPasswordIngress,
    createIngress,
  });
})(typeof globalThis === 'undefined' ? this : globalThis);
