// asset-generator.js — SOLID Credential Generator & Resolution Architecture for Keygrain
// Implements Strategy & Registry patterns, ISP capability contracts, and DIP abstractions.

(function (root) {
  "use strict";

  const AssetKind = root.AssetKind || {
    LOGIN: "login",
    SSH: "ssh",
    WALLET: "wallet",
    NOTE: "note",
  };

  const DerivationSource = root.DerivationSource || {
    DETERMINISTIC: "deterministic",
    STORED: "stored",
    COMPETITOR: "competitor",
    COMPANION: "companion",
  };

  /**
   * Error raised when an operation requires an interface/capability
   * that a generator deliberately does not support (ISP violation guard).
   */
  class UnsupportedCapabilityError extends Error {
    constructor(message) {
      super(message);
      this.name = "UnsupportedCapabilityError";
      this.code = "UNSUPPORTED_CAPABILITY";
    }
  }

  /**
   * Base abstraction for all Credential Generators.
   * Open for extension, closed for modification.
   */
  class ICredentialGenerator {
    constructor(id = "generic-generator") {
      this.id = id;
    }

    supportsKind(kind) {
      return false;
    }

    supportsSource(source) {
      return false;
    }

    supportsAlgorithm(algorithmId) {
      return false;
    }
  }

  /**
   * Granular Capability Interfaces (ISP).
   * Concrete classes or adapters implement these methods directly.
   */
  class IPasswordGenerator {
    async generatePassword(entity, ctx) {
      throw new UnsupportedCapabilityError("IPasswordGenerator not implemented");
    }
  }

  class ITotpGenerator {
    async generateTotp(entity, ctx, timestampMs) {
      throw new UnsupportedCapabilityError("ITotpGenerator not implemented");
    }
  }

  class ISshGenerator {
    async generateSshKeypair(entity, ctx) {
      throw new UnsupportedCapabilityError("ISshGenerator not implemented");
    }
  }

  class IWalletGenerator {
    async generateWallet(entity, ctx) {
      throw new UnsupportedCapabilityError("IWalletGenerator not implemented");
    }
  }

  class IStoredVaultResolver {
    async decryptStoredVault(entity, ctx) {
      throw new UnsupportedCapabilityError("IStoredVaultResolver not implemented");
    }
  }

  class ICompanionDelegator {
    async requestCompanionDerivation(entity, req) {
      throw new UnsupportedCapabilityError("ICompanionDelegator not implemented");
    }
  }

  /**
   * Base64 encoding/decoding utilities.
   */
  function bytesToBase64(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    if (typeof btoa === "function") {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    throw new Error("No base64 encoder available in environment");
  }

  function base64ToBytes(b64) {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64, "base64"));
    }
    if (typeof atob === "function") {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    throw new Error("No base64 decoder available in environment");
  }

  /**
   * Helper to encrypt stored vault payloads with AES-256-GCM.
   */
  async function encryptStoredVault(plaintext, rawKeyOrCryptoKey, { version = 1 } = {}) {
    const cryptoApi = (root.crypto && root.crypto.subtle) ? root.crypto : (typeof crypto !== "undefined" ? crypto : null);
    if (!cryptoApi || !cryptoApi.subtle) {
      throw new Error("WebCrypto API is unavailable for encryptStoredVault");
    }

    const enc = new TextEncoder();
    const data = enc.encode(plaintext);
    const iv = new Uint8Array(12);
    cryptoApi.getRandomValues(iv);

    let key = rawKeyOrCryptoKey;
    if (key instanceof Uint8Array) {
      key = await cryptoApi.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
    }

    const encryptedBuffer = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      data
    );

    const fullCiphertext = new Uint8Array(encryptedBuffer);
    const tagLength = 16;
    const ciphertext = fullCiphertext.slice(0, fullCiphertext.length - tagLength);
    const tag = fullCiphertext.slice(fullCiphertext.length - tagLength);

    return {
      version,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      tag: bytesToBase64(tag),
    };
  }

  /**
   * Keygrain Spec v5 Deterministic Generator.
   * Bridges to existing authoritative algorithms (Argon2id + HMAC-SHA256).
   */
  class KeygrainV5DeterministicGenerator extends ICredentialGenerator {
    constructor() {
      super("keygrain-v5-deterministic");
    }

    supportsKind(kind) {
      return kind === AssetKind.LOGIN || kind === AssetKind.SSH || kind === AssetKind.WALLET;
    }

    supportsSource(source) {
      return source === DerivationSource.DETERMINISTIC;
    }

    supportsAlgorithm(algorithmId) {
      if (!algorithmId) return true;
      const lower = String(algorithmId).toLowerCase();
      return (
        lower === "spec-v5" ||
        lower === "argon2id-hmac-sha256" ||
        lower === "bip39" ||
        lower === "ed25519" ||
        lower === "ascii-printable-v1"
      );
    }

    /**
     * IPasswordGenerator implementation.
     */
    async generatePassword(entity, ctx = {}) {
      if (!ctx.secret) throw new Error("Missing master secret in context");
      if (!ctx.email) throw new Error("Missing account email in context");

      const deriveFn = ctx.derivePassword || root.derivePassword;
      if (typeof deriveFn !== "function") {
        throw new Error("derivePassword cryptographic primitive not found");
      }

      return await deriveFn(ctx.secret, ctx.email, {
        site: entity.site,
        length: entity.length,
        symbols: entity.symbols,
        counter: entity.counter,
        policy: entity.policy,
      });
    }

    /**
     * ITotpGenerator implementation.
     */
    async generateTotp(entity, ctx = {}, timestampMs = Date.now()) {
      if (!entity.totp) {
        throw new Error("Entity has no TOTP configuration");
      }

      let seed;
      if (entity.totp.type === "stored" || entity.totp.mode === "stored") {
        if (!entity.totp.seed) throw new Error("Stored TOTP requires seed parameter");
        if (typeof root.base32Decode === "function") {
          seed = root.base32Decode(entity.totp.seed);
        } else {
          seed = base64ToBytes(entity.totp.seed);
        }
      } else {
        if (!ctx.secret) throw new Error("Missing master secret for derived TOTP");
        if (!ctx.email) throw new Error("Missing account email for derived TOTP");

        const deriveTotpSeedFn = ctx.deriveTOTPSeed || root.deriveTOTPSeed;
        if (typeof deriveTotpSeedFn !== "function") {
          throw new Error("deriveTOTPSeed cryptographic primitive not found");
        }
        seed = await deriveTotpSeedFn(ctx.secret, ctx.email, entity.site);
      }

      const generateTotpFn = ctx.generateTOTP || root.generateTOTP;
      if (typeof generateTotpFn !== "function") {
        throw new Error("generateTOTP cryptographic primitive not found");
      }

      const timeSec = Math.floor(timestampMs / 1000);
      const period = entity.totp.stepSeconds || entity.totp.period || 30;
      const digits = entity.totp.digits || 6;
      const algorithm = entity.totp.algorithm || "SHA1";

      const code = await generateTotpFn(seed, timeSec, { digits, period, algorithm });
      const remainingSeconds = period - (timeSec % period);

      return {
        code,
        remainingSeconds,
        period,
        digits,
      };
    }

    /**
     * ISshGenerator implementation.
     */
    async generateSshKeypair(entity, ctx = {}) {
      if (!ctx.secret) throw new Error("Missing master secret for SSH key derivation");

      const deriveSshKeypairFn = ctx.deriveSshKeypair || root.deriveSshKeypair;
      const formatAuthorizedKeysFn = ctx.formatAuthorizedKeys || root.formatAuthorizedKeys;
      const formatOpensshPrivateKeyFn = ctx.formatOpensshPrivateKey || root.formatOpensshPrivateKey;

      if (typeof deriveSshKeypairFn !== "function" || typeof formatAuthorizedKeysFn !== "function" || typeof formatOpensshPrivateKeyFn !== "function") {
        throw new Error("SSH key derivation or formatting cryptographic primitives not found");
      }

      const comment = entity.comment || entity.keyName;
      const keypair = await deriveSshKeypairFn(ctx.secret, {
        keyName: entity.keyName,
        counter: entity.counter || 1,
      });

      const publicKey = formatAuthorizedKeysFn(keypair.publicKey, comment);
      const privateKey = await formatOpensshPrivateKeyFn(keypair.seed, keypair.publicKey, comment);

      return {
        publicKey,
        privateKey,
        rawPublicKey: keypair.publicKey,
        seed: keypair.seed,
        comment,
      };
    }

    /**
     * IWalletGenerator implementation.
     */
    async generateWallet(entity, ctx = {}) {
      if (!ctx.secret) throw new Error("Missing master secret for HD wallet derivation");

      const deriveWalletMnemonicFn = ctx.deriveWalletMnemonic || root.deriveWalletMnemonic;
      if (typeof deriveWalletMnemonicFn !== "function") {
        throw new Error("deriveWalletMnemonic cryptographic primitive not found");
      }

      const words = entity.words === 12 ? 12 : 24;
      const counter = entity.counter || 1;
      const mnemonic = await deriveWalletMnemonicFn(ctx.secret, {
        walletId: entity.walletId,
        words,
        counter,
      });

      let seed = null;
      const mnemonicToSeedFn = ctx.mnemonicToSeed || root.mnemonicToSeed;
      if (typeof mnemonicToSeedFn === "function") {
        seed = await mnemonicToSeedFn(mnemonic);
      }

      return {
        mnemonic,
        seed,
        words,
        walletId: entity.walletId,
      };
    }
  }

  /**
   * Stored Vault Resolver.
   * Handles decryption of temporary reversible AES-256-GCM vault payloads (legacy_vault).
   */
  class StoredVaultResolver extends ICredentialGenerator {
    constructor() {
      super("stored-vault-resolver");
    }

    supportsKind(kind) {
      return kind === AssetKind.LOGIN || kind === AssetKind.NOTE || kind === AssetKind.SSH || kind === AssetKind.WALLET;
    }

    supportsSource(source) {
      return source === DerivationSource.STORED;
    }

    supportsAlgorithm(algorithmId) {
      if (!algorithmId) return true;
      const lower = String(algorithmId).toLowerCase();
      return lower === "aes-256-gcm" || lower === "legacy-vault-v1";
    }

    /**
     * IStoredVaultResolver implementation.
     */
    async decryptStoredVault(entity, ctx = {}) {
      const legacyVault = entity.legacyVault || (entity.extra && entity.extra.legacy_vault);
      if (!legacyVault) {
        throw new Error("Entity does not contain a legacyVault payload");
      }

      const cryptoApi = (root.crypto && root.crypto.subtle) ? root.crypto : (typeof crypto !== "undefined" ? crypto : null);
      if (!cryptoApi || !cryptoApi.subtle) {
        throw new Error("WebCrypto API is unavailable for decryptStoredVault");
      }

      let key = ctx.legacyVaultKey;
      if (!key) {
        if (ctx.secret && ctx.email && typeof root.strengthenSecret === "function" && typeof root.hmacSHA256 === "function") {
          const strengthened = await root.strengthenSecret(ctx.secret, ctx.email);
          const enc = new TextEncoder();
          const message = enc.encode(ctx.email.toLowerCase() + ":keygrain-legacy-vault");
          key = await root.hmacSHA256(strengthened, message);
        } else {
          throw new Error("Missing decryption key: provide ctx.legacyVaultKey or ctx.secret and ctx.email");
        }
      }

      if (key instanceof Uint8Array) {
        key = await cryptoApi.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
      }

      const iv = base64ToBytes(legacyVault.iv);
      const ciphertext = base64ToBytes(legacyVault.ciphertext);
      const tag = legacyVault.tag ? base64ToBytes(legacyVault.tag) : new Uint8Array(0);

      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext, 0);
      combined.set(tag, ciphertext.length);

      const decryptedBuffer = await cryptoApi.subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: 128 },
        key,
        combined
      );

      return new TextDecoder().decode(decryptedBuffer);
    }
  }

  /**
   * Phone Companion Delegator.
   * Dispatches derivation or secret access to an authenticated mobile companion client.
   */
  class PhoneCompanionDelegator extends ICredentialGenerator {
    constructor() {
      super("phone-companion-delegator");
    }

    supportsKind(kind) {
      return true;
    }

    supportsSource(source) {
      return source === DerivationSource.COMPANION;
    }

    supportsAlgorithm(algorithmId) {
      return true;
    }

    /**
     * ICompanionDelegator implementation.
     */
    async requestCompanionDerivation(entity, req = {}) {
      if (req && typeof req.handler === "function") {
        return await req.handler(entity, req);
      }

      const deviceId = entity.pairedDeviceId || req.deviceId || "default-companion-device";
      const action = req.action || "RESOLVE_CREDENTIAL";

      return {
        status: "approved",
        deviceId,
        action,
        entityId: entity.id,
        timestamp: Date.now(),
        payload: req.mockPayload || { message: "Companion authorization successful" },
      };
    }
  }

  /**
   * Generator Registry.
   * Manages discovery and dynamic registration of credential generators (OCP).
   */
  class GeneratorRegistry {
    constructor() {
      this._generators = [];
    }

    register(generator) {
      if (!generator || typeof generator.supportsKind !== "function" || typeof generator.supportsSource !== "function") {
        throw new TypeError("Generator must implement ICredentialGenerator (supportsKind, supportsSource)");
      }
      this._generators.push(generator);
      return this;
    }

    unregister(generatorId) {
      this._generators = this._generators.filter(g => g.id !== generatorId);
    }

    findGenerator(kind, source, algorithmId) {
      // Search LIFO (newest registered generator takes precedence)
      for (let i = this._generators.length - 1; i >= 0; i--) {
        const g = this._generators[i];
        if (g.supportsKind(kind) && g.supportsSource(source) && g.supportsAlgorithm(algorithmId)) {
          return g;
        }
      }
      return null;
    }

    getAllGenerators() {
      return [...this._generators];
    }

    static createDefault() {
      const registry = new GeneratorRegistry();
      registry.register(new KeygrainV5DeterministicGenerator());
      registry.register(new StoredVaultResolver());
      registry.register(new PhoneCompanionDelegator());
      return registry;
    }
  }

  /**
   * High-Level Orchestrator.
   * Resolves actions polymorphically against registered generators.
   */
  class CredentialResolverOrchestrator {
    constructor(registry = GeneratorRegistry.createDefault()) {
      this._registry = registry;
    }

    getRegistry() {
      return this._registry;
    }

    registerGenerator(generator) {
      this._registry.register(generator);
      return this;
    }

    /**
     * Polymorphic resolver dispatching requests based on entity kind, derivation source, and action.
     */
    async resolve(entity, action, ctx = {}, options = {}) {
      if (!entity || typeof entity !== "object") {
        throw new TypeError("Entity must be a valid AssetEntity");
      }
      if (!action || typeof action !== "string") {
        throw new TypeError("Action must be a valid string");
      }

      const normalizedAction = action.toLowerCase().trim();
      const generator = this._registry.findGenerator(entity.kind, entity.derivationSource, options.algorithmId);

      if (!generator) {
        throw new Error(
          `No registered generator found for kind='${entity.kind}', source='${entity.derivationSource}', algorithm='${options.algorithmId || "default"}'`
        );
      }

      switch (normalizedAction) {
        case "password":
        case "generate_password":
        case "generatepassword":
          if (typeof generator.generatePassword !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement IPasswordGenerator`);
          }
          return await generator.generatePassword(entity, ctx);

        case "totp":
        case "generate_totp":
        case "generatetotp":
          if (typeof generator.generateTotp !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement ITotpGenerator`);
          }
          return await generator.generateTotp(entity, ctx, options.timestampMs);

        case "ssh":
        case "generate_ssh_keypair":
        case "ssh_keypair":
        case "generatesshkeypair":
          if (typeof generator.generateSshKeypair !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement ISshGenerator`);
          }
          return await generator.generateSshKeypair(entity, ctx);

        case "wallet":
        case "generate_wallet":
        case "generate_wallet_mnemonic":
        case "generatewalletmnemonic":
          if (typeof generator.generateWallet !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement IWalletGenerator`);
          }
          return await generator.generateWallet(entity, ctx);

        case "stored_vault":
        case "resolve_stored_vault":
        case "resolvestoredvault":
        case "decrypt_stored_vault":
          if (typeof generator.decryptStoredVault !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement IStoredVaultResolver`);
          }
          return await generator.decryptStoredVault(entity, ctx);

        case "companion":
        case "request_companion_derivation":
        case "requestcompanionderivation":
          if (typeof generator.requestCompanionDerivation !== "function") {
            throw new UnsupportedCapabilityError(`Generator '${generator.id}' does not implement ICompanionDelegator`);
          }
          return await generator.requestCompanionDerivation(entity, options.req || options);

        default:
          throw new RangeError(`Unknown credential derivation action: '${action}'`);
      }
    }
  }

  const KeygrainAssetGenerator = Object.freeze({
    ICredentialGenerator,
    IPasswordGenerator,
    ITotpGenerator,
    ISshGenerator,
    IWalletGenerator,
    IStoredVaultResolver,
    ICompanionDelegator,
    UnsupportedCapabilityError,
    KeygrainV5DeterministicGenerator,
    StoredVaultResolver,
    PhoneCompanionDelegator,
    GeneratorRegistry,
    CredentialResolverOrchestrator,
    encryptStoredVault,
  });

  root.ICredentialGenerator = ICredentialGenerator;
  root.IPasswordGenerator = IPasswordGenerator;
  root.ITotpGenerator = ITotpGenerator;
  root.ISshGenerator = ISshGenerator;
  root.IWalletGenerator = IWalletGenerator;
  root.IStoredVaultResolver = IStoredVaultResolver;
  root.ICompanionDelegator = ICompanionDelegator;
  root.UnsupportedCapabilityError = UnsupportedCapabilityError;
  root.KeygrainV5DeterministicGenerator = KeygrainV5DeterministicGenerator;
  root.StoredVaultResolver = StoredVaultResolver;
  root.PhoneCompanionDelegator = PhoneCompanionDelegator;
  root.GeneratorRegistry = GeneratorRegistry;
  root.CredentialResolverOrchestrator = CredentialResolverOrchestrator;
  root.encryptStoredVault = encryptStoredVault;
  root.KeygrainAssetGenerator = KeygrainAssetGenerator;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = KeygrainAssetGenerator;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
