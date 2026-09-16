// asset-entity.js — Unified Common Entity Model for Keygrain
// Encapsulates immutable identity, classification, display parameters, and metadata projections.
// Strictly adheres to SOLID principles (SRP, OCP, LSP, ISP, DIP).

(function (root) {
  "use strict";

  /**
   * Discriminated asset classifications.
   * Closed for modification to enable exhaustive classification across UI and sync layers.
   */
  const AssetKind = Object.freeze({
    LOGIN: "login",
    SSH: "ssh",
    WALLET: "wallet",
    NOTE: "note",
  });

  /**
   * Sovereign derivation and retrieval source classifications.
   */
  const DerivationSource = Object.freeze({
    DETERMINISTIC: "deterministic",
    STORED: "stored",
    COMPETITOR: "competitor",
    COMPANION: "companion",
  });

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const WALLET_SLUG_REGEX = /^[a-z0-9\-]+$/;
  const DEFAULT_SYMBOLS = "!@#$%&*-_=+?";
  const DEFAULT_SYMBOL_POLICY = "ascii-printable-v1";

  /**
   * Generates a standard RFC 4122 v4 UUID.
   */
  function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  function isValidIdentifier(id) {
    if (typeof id !== "string") return false;
    const trimmed = id.trim();
    if (trimmed.length === 0) return false;
    if (/[\s\x00-\x1f\x7f]/.test(id)) return false;
    return true;
  }

  function normalizeSiteDomain(site) {
    if (!site || typeof site !== "string") return "";
    return site
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0]
      .replace(/\/$/, "")
      .toLowerCase()
      .replace(/^www\./, "");
  }

  function cleanKeyName(keyName) {
    if (typeof keyName !== "string") return "";
    return keyName.trim().replace(/\s+/g, "-").toLowerCase();
  }

  /**
   * Validates common entity invariants. Throws Error on violation.
   */
  function validateEntity(entity) {
    if (!entity || typeof entity !== "object") {
      throw new TypeError("Entity must be a non-null object");
    }

    if (!isValidIdentifier(entity.id)) {
      throw new RangeError("Invalid entity id: must be a non-empty identifier without whitespace or control chars");
    }

    const validKinds = Object.values(AssetKind);
    if (!validKinds.includes(entity.kind)) {
      throw new RangeError(`Invalid entity kind '${entity.kind}'. Must be one of: ${validKinds.join(", ")}`);
    }

    if (typeof entity.label !== "string" || entity.label.trim().length === 0) {
      throw new RangeError("Entity label must be a non-empty string");
    }

    if (!Number.isSafeInteger(entity.createdAt) || entity.createdAt < 0) {
      throw new RangeError("createdAt must be a non-negative integer");
    }

    if (!Number.isSafeInteger(entity.updatedAt) || entity.updatedAt < 0) {
      throw new RangeError("updatedAt must be a non-negative integer");
    }

    if (typeof entity.frecency !== "number" || isNaN(entity.frecency) || entity.frecency < 0) {
      throw new RangeError("frecency must be a non-negative number");
    }

    if (!Number.isSafeInteger(entity.version) || entity.version < 1) {
      throw new RangeError("version must be a positive integer (>= 1)");
    }

    if (typeof entity.tombstoned !== "boolean") {
      throw new TypeError("tombstoned must be a boolean");
    }

    if (typeof entity.derivationSource !== "string" || entity.derivationSource.trim().length === 0) {
      throw new RangeError("derivationSource must be a non-empty string");
    }

    if (entity.kind === AssetKind.LOGIN) {
      if (typeof entity.site !== "string" || entity.site.trim().length === 0) {
        throw new RangeError("Login entity must specify a non-empty site");
      }
      if (typeof entity.username !== "string") {
        throw new TypeError("Login entity username must be a string");
      }
      if (!Number.isSafeInteger(entity.length) || entity.length < 4 || entity.length > 128) {
        throw new RangeError("Login entity length must be an integer between 4 and 128");
      }
      if (!Number.isSafeInteger(entity.counter) || entity.counter < 1) {
        throw new RangeError("Login entity counter must be an integer >= 1");
      }
      if (typeof entity.symbols !== "string" || entity.symbols.length === 0) {
        throw new RangeError("Login entity symbols must be a non-empty string");
      }
    } else if (entity.kind === AssetKind.SSH) {
      if (typeof entity.keyName !== "string" || entity.keyName.trim().length === 0) {
        throw new RangeError("SSH entity must specify a non-empty keyName");
      }
      if (entity.keyName.includes(":") || /[\x00-\x1f\x7f]/.test(entity.keyName)) {
        throw new RangeError("SSH keyName must not contain colons or control characters");
      }
      if (!Number.isSafeInteger(entity.counter) || entity.counter < 1) {
        throw new RangeError("SSH entity counter must be an integer >= 1");
      }
    } else if (entity.kind === AssetKind.WALLET) {
      if (typeof entity.walletId !== "string" || !WALLET_SLUG_REGEX.test(entity.walletId)) {
        throw new RangeError(`Wallet entity walletId must match /^[a-z0-9\\-]+$/, got '${entity.walletId}'`);
      }
      if (entity.words !== 12 && entity.words !== 24) {
        throw new RangeError(`Wallet entity words must be 12 or 24, got ${entity.words}`);
      }
      if (!Number.isSafeInteger(entity.counter) || entity.counter < 1) {
        throw new RangeError("Wallet entity counter must be an integer >= 1");
      }
    }

    return true;
  }

  /**
   * Factory for LoginAssetEntity.
   */
  function createLoginEntity(params = {}) {
    const rawSite = params.site || params.name || "";
    const site = normalizeSiteDomain(rawSite);
    const label = (params.label || params.name || rawSite || "Login").trim();
    const id = (params.id !== undefined && params.id !== null) ? params.id : generateUUID();
    const username = String(params.username ?? params.email ?? "").trim();
    const length = params.length !== undefined ? params.length : 20;
    const symbols = params.symbols !== undefined ? params.symbols : DEFAULT_SYMBOLS;
    const counter = params.counter !== undefined ? params.counter : 1;
    const policy = typeof params.policy === "string" ? params.policy : DEFAULT_SYMBOL_POLICY;
    const now = Date.now();
    const createdAt = Number.isSafeInteger(params.createdAt) ? params.createdAt : (Number.isSafeInteger(params.created_at) ? params.created_at : now);
    const updatedAt = Number.isSafeInteger(params.updatedAt) ? params.updatedAt : (Number.isSafeInteger(params.updated_at) ? params.updated_at : now);
    const frecency = typeof params.frecency === "number" && !isNaN(params.frecency) ? params.frecency : 0;
    const tags = Array.isArray(params.tags) ? Object.freeze([...params.tags]) : Object.freeze([]);
    const version = Number.isSafeInteger(params.version) && params.version >= 1 ? params.version : 1;
    const tombstoned = Boolean(params.tombstoned);
    const migrating = Boolean(params.migrating);
    const legacyVault = params.legacyVault || params.legacy_vault || null;

    let derivationSource = params.derivationSource;
    if (!derivationSource) {
      derivationSource = (legacyVault || migrating) ? DerivationSource.STORED : DerivationSource.DETERMINISTIC;
    }

    let totp = null;
    if (params.totp && typeof params.totp === "object") {
      totp = Object.freeze({
        type: params.totp.type || params.totp.mode || "derived",
        counter: Number.isSafeInteger(params.totp.counter) ? params.totp.counter : 1,
        stepSeconds: Number.isSafeInteger(params.totp.stepSeconds) ? params.totp.stepSeconds : (Number.isSafeInteger(params.totp.period) ? params.totp.period : 30),
        digits: params.totp.digits === 8 ? 8 : 6,
        algorithm: (params.totp.algorithm || "SHA1").toUpperCase(),
        seed: params.totp.seed || null,
      });
    }

    const entity = Object.freeze({
      id,
      kind: AssetKind.LOGIN,
      label,
      site,
      username,
      length,
      symbols,
      counter,
      policy,
      totp,
      migrating,
      legacyVault: legacyVault ? Object.freeze({ ...legacyVault }) : null,
      derivationSource,
      createdAt,
      updatedAt,
      frecency,
      tags,
      version,
      tombstoned,
      extra: params.extra ? Object.freeze({ ...params.extra }) : Object.freeze({}),
    });

    validateEntity(entity);
    return entity;
  }

  /**
   * Factory for SshAssetEntity.
   */
  function createSshEntity(params = {}) {
    const rawKeyName = params.keyName || params.key_name || "";
    const keyName = cleanKeyName(rawKeyName);
    const label = (params.label || params.name || rawKeyName || "SSH Key").trim();
    const id = (params.id !== undefined && params.id !== null) ? params.id : generateUUID();
    const counter = params.counter !== undefined ? params.counter : 1;
    const comment = typeof params.comment === "string" ? params.comment : keyName;
    const now = Date.now();
    const createdAt = Number.isSafeInteger(params.createdAt) ? params.createdAt : (Number.isSafeInteger(params.created_at) ? params.created_at : now);
    const updatedAt = Number.isSafeInteger(params.updatedAt) ? params.updatedAt : (Number.isSafeInteger(params.updated_at) ? params.updated_at : now);
    const frecency = typeof params.frecency === "number" && !isNaN(params.frecency) ? params.frecency : 0;
    const tags = Array.isArray(params.tags) ? Object.freeze([...params.tags]) : Object.freeze([]);
    const version = Number.isSafeInteger(params.version) && params.version >= 1 ? params.version : 1;
    const tombstoned = Boolean(params.tombstoned);
    const derivationSource = params.derivationSource || DerivationSource.DETERMINISTIC;

    const entity = Object.freeze({
      id,
      kind: AssetKind.SSH,
      label,
      keyName,
      counter,
      comment,
      derivationSource,
      createdAt,
      updatedAt,
      frecency,
      tags,
      version,
      tombstoned,
      extra: params.extra ? Object.freeze({ ...params.extra }) : Object.freeze({}),
    });

    validateEntity(entity);
    return entity;
  }

  /**
   * Factory for WalletAssetEntity.
   * In accordance with Spec v5, derivation depends solely on:
   *   - Cryptographic parameters: walletId, words (12 | 24), counter
   *   - Metadata parameters: label, notes
   *   - Output: 12 or 24-word BIP-39 mnemonic seed phrase
   * Derivation is decoupled from external network identifiers and not part of the derivation spec.
   */
  function createWalletEntity(params = {}) {
    const rawWalletId = params.walletId || params.wallet_id || params.walletName || params.wallet_name || "";
    const walletId = typeof rawWalletId === "string" ? rawWalletId.trim() : "";
    const label = (params.label || params.name || params.walletName || params.wallet_name || rawWalletId || "Wallet").trim();
    const id = (params.id !== undefined && params.id !== null) ? params.id : generateUUID();
    const words = params.words !== undefined ? params.words : 24;
    const counter = params.counter !== undefined ? params.counter : 1;
    const notes = typeof params.notes === "string" ? params.notes : "";
    const now = Date.now();
    const createdAt = Number.isSafeInteger(params.createdAt) ? params.createdAt : (Number.isSafeInteger(params.created_at) ? params.created_at : now);
    const updatedAt = Number.isSafeInteger(params.updatedAt) ? params.updatedAt : (Number.isSafeInteger(params.updated_at) ? params.updated_at : now);
    const frecency = typeof params.frecency === "number" && !isNaN(params.frecency) ? params.frecency : 0;
    const tags = Array.isArray(params.tags) ? Object.freeze([...params.tags]) : Object.freeze([]);
    const version = Number.isSafeInteger(params.version) && params.version >= 1 ? params.version : 1;
    const tombstoned = Boolean(params.tombstoned);
    const derivationSource = params.derivationSource || DerivationSource.DETERMINISTIC;

    const entity = Object.freeze({
      id,
      kind: AssetKind.WALLET,
      label,
      walletId,
      words,
      counter,
      notes,
      derivationSource,
      createdAt,
      updatedAt,
      frecency,
      tags,
      version,
      tombstoned,
      extra: params.extra ? Object.freeze({ ...params.extra }) : Object.freeze({}),
    });

    validateEntity(entity);
    return entity;
  }

  /**
   * Factory for generic AssetEntity (e.g. NOTE or custom companion/stored kinds).
   */
  function createGenericEntity(params = {}) {
    const id = (params.id !== undefined && params.id !== null) ? params.id : generateUUID();
    const kind = params.kind || AssetKind.NOTE;
    const label = (params.label || params.name || params.title || "Generic Entity").trim();
    const now = Date.now();
    const createdAt = Number.isSafeInteger(params.createdAt) ? params.createdAt : now;
    const updatedAt = Number.isSafeInteger(params.updatedAt) ? params.updatedAt : now;
    const frecency = typeof params.frecency === "number" && !isNaN(params.frecency) ? params.frecency : 0;
    const tags = Array.isArray(params.tags) ? Object.freeze([...params.tags]) : Object.freeze([]);
    const version = Number.isSafeInteger(params.version) && params.version >= 1 ? params.version : 1;
    const tombstoned = Boolean(params.tombstoned);
    const derivationSource = params.derivationSource || DerivationSource.DETERMINISTIC;

    const length = Number.isSafeInteger(params.length) ? params.length : 20;
    const symbols = typeof params.symbols === "string" && params.symbols.length > 0 ? params.symbols : DEFAULT_SYMBOLS;
    const counter = Number.isSafeInteger(params.counter) && params.counter >= 1 ? params.counter : 1;
    const policy = typeof params.policy === "string" ? params.policy : DEFAULT_SYMBOL_POLICY;

    const entity = Object.freeze({
      id,
      kind,
      label,
      derivationSource,
      createdAt,
      updatedAt,
      frecency,
      tags,
      version,
      tombstoned,
      pairedDeviceId: params.pairedDeviceId || null,
      site: params.site || "",
      username: params.username || "",
      length,
      symbols,
      counter,
      policy,
      notes: params.notes || "",
      extra: params.extra ? Object.freeze({ ...params.extra }) : Object.freeze({}),
    });

    validateEntity(entity);
    return entity;
  }

  /**
   * Converts any AssetEntity into a sanitized MetadataDescriptor.
   * Invariant: Zero-Knowledge. Under no circumstance may private keys, mnemonics,
   * plaintext passwords, or ciphertext leak into this structure.
   */
  function toMetadataDescriptor(entity) {
    if (!entity || typeof entity !== "object") {
      throw new TypeError("Entity must be a valid object");
    }

    validateEntity(entity);

    let descriptor = "";
    const badges = [];
    const searchTokenSet = new Set();
    const capabilities = new Set();

    function addSearchTokens(...values) {
      for (const val of values) {
        if (!val || typeof val !== "string") continue;
        const tokens = val.toLowerCase().split(/[\s/:@#._\-+]+/);
        for (const token of tokens) {
          if (token.length > 0) searchTokenSet.add(token);
        }
      }
    }

    addSearchTokens(entity.label, ...(entity.tags || []));

    if (entity.kind === AssetKind.LOGIN) {
      if (entity.username && entity.site) {
        descriptor = entity.site.toLowerCase() === entity.username.toLowerCase()
          ? entity.site
          : `${entity.username} • ${entity.site}`;
      } else {
        descriptor = entity.username || entity.site || entity.label;
      }

      addSearchTokens(entity.site, entity.username);

      if (entity.totp) badges.push("TOTP");
      if (entity.counter > 1) badges.push(`v${entity.counter}`);
      if (entity.migrating) badges.push("MIGRATE");
      if (entity.derivationSource === DerivationSource.STORED || entity.legacyVault) badges.push("STORED");

      capabilities.add("GENERATE_PASSWORD");
      capabilities.add("AUTOFILL_LOGIN");
      if (entity.totp) capabilities.add("GENERATE_TOTP");
      if (entity.derivationSource === DerivationSource.STORED || entity.legacyVault) {
        capabilities.add("RESOLVE_STORED_VAULT");
      }
    } else if (entity.kind === AssetKind.SSH) {
      descriptor = entity.comment || entity.keyName;
      addSearchTokens(entity.keyName, entity.comment);

      badges.push("ED25519");
      if (entity.counter > 1) badges.push(`v${entity.counter}`);

      capabilities.add("GENERATE_SSH_KEYPAIR");
      capabilities.add("EXPORT_PUBLIC_KEY");
      capabilities.add("EXPORT_PRIVATE_KEY");
    } else if (entity.kind === AssetKind.WALLET) {
      descriptor = entity.notes || `${entity.words} words • counter ${entity.counter}`;
      addSearchTokens(entity.walletId, entity.notes);

      badges.push(`BIP-39 ${entity.words}w`);
      if (entity.counter > 1) badges.push(`v${entity.counter}`);

      capabilities.add("GENERATE_WALLET_MNEMONIC");
      capabilities.add("DERIVE_WALLET_SEED");
    } else {
      descriptor = entity.notes || (entity.tags && entity.tags.length > 0 ? entity.tags.join(", ") : entity.label);
      addSearchTokens(entity.notes, entity.site, entity.username);
      capabilities.add("READ_NOTE");
    }

    if (entity.derivationSource === DerivationSource.COMPANION) {
      badges.push("COMPANION");
      capabilities.add("REQUEST_COMPANION_DERIVATION");
    } else if (entity.derivationSource === DerivationSource.COMPETITOR) {
      badges.push("COMPETITOR");
    }

    const domain = entity.site || (entity.extra && entity.extra.site) || undefined;

    return Object.freeze({
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      title: entity.label,
      descriptor,
      subtitle: descriptor,
      domain,
      badges: Object.freeze(badges),
      searchTerms: Object.freeze(Array.from(searchTokenSet).sort()),
      frecency: entity.frecency || 0,
      capabilities: capabilities, // Set of strings
    });
  }

  /**
   * Matches an entity against host and context for unified autofill operations.
   */
  function matchesAutofill(entity, host, context = {}) {
    if (!entity || entity.tombstoned) return false;
    if (!host || typeof host !== "string") return false;

    const cleanHost = host
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0];

    if (!cleanHost) return false;

    if (entity.kind === AssetKind.LOGIN) {
      const site = (entity.site || "").toLowerCase().trim();
      if (!site) return false;

      // Host matching rule: exact match or dot-anchored subdomain match
      const hostMatches = (cleanHost === site || cleanHost.endsWith("." + site));
      if (!hostMatches) return false;

      // OTP / 2FA field gate
      if (context.isOtp || context.type === "totp") {
        return Boolean(entity.totp);
      }

      // Page identity corroboration if supplied
      if (context.pageEmail && entity.username) {
        return entity.username.toLowerCase() === String(context.pageEmail).toLowerCase().trim();
      }

      return true;
    }

    if (entity.kind === AssetKind.WALLET) {
      const isWeb3Context = context.type === "wallet" || context.isWeb3 === true;
      if (!isWeb3Context) return false;

      // If specific dApp domain or tag matching
      if (entity.site && cleanHost === entity.site.toLowerCase()) return true;
      if (entity.tags && entity.tags.length > 0) {
        return entity.tags.some(t => t.toLowerCase() === cleanHost || cleanHost.endsWith("." + t.toLowerCase()));
      }

      // Default Web3 dApp provider matches wallets if no tag constraints
      return true;
    }

    return false;
  }

  /**
   * Legacy Converter: ServiceEntry <-> LoginAssetEntity
   */
  function fromLegacyService(service = {}) {
    return createLoginEntity({
      id: service.id,
      label: service.name || service.site || "Login",
      site: service.site,
      username: service.email,
      length: service.length,
      symbols: service.symbols,
      counter: service.counter,
      policy: service.policy,
      totp: service.totp,
      migrating: service.migrating,
      legacyVault: service.legacy_vault,
      createdAt: service.created_at,
      updatedAt: service.updated_at,
      frecency: service.frecency,
      tombstoned: service.tombstoned,
      extra: {
        synced: service.synced,
        ssh: service.ssh,
        ...service,
      },
    });
  }

  function toLegacyService(entity) {
    if (!entity || entity.kind !== AssetKind.LOGIN) {
      throw new TypeError("Entity must be a valid LoginAssetEntity");
    }
    const legacy = {
      id: entity.id,
      name: entity.label,
      site: entity.site,
      email: entity.username,
      length: entity.length,
      symbols: entity.symbols,
      counter: entity.counter,
      policy: entity.policy,
      frecency: entity.frecency,
      updated_at: entity.updatedAt,
      created_at: entity.createdAt,
      tombstoned: entity.tombstoned,
      ...(entity.extra || {}),
    };

    if (entity.totp) {
      legacy.totp = {
        type: entity.totp.type,
        counter: entity.totp.counter,
        step_seconds: entity.totp.stepSeconds,
        digits: entity.totp.digits,
        algorithm: entity.totp.algorithm,
        ...(entity.totp.seed ? { seed: entity.totp.seed } : {}),
      };
    } else {
      delete legacy.totp;
    }

    if (entity.migrating) legacy.migrating = true;
    if (entity.legacyVault) legacy.legacy_vault = { ...entity.legacyVault };

    return legacy;
  }

  /**
   * Legacy Converter: SshKeyEntry <-> SshAssetEntity
   */
  function fromLegacySshKey(sshKey = {}) {
    return createSshEntity({
      id: sshKey.id,
      label: sshKey.name || sshKey.key_name || "SSH Key",
      keyName: sshKey.key_name || sshKey.keyName,
      counter: sshKey.counter,
      comment: sshKey.comment,
      createdAt: sshKey.created_at,
      updatedAt: sshKey.updated_at,
      frecency: sshKey.frecency,
      tombstoned: sshKey.tombstoned,
      extra: { ...sshKey },
    });
  }

  function toLegacySshKey(entity) {
    if (!entity || entity.kind !== AssetKind.SSH) {
      throw new TypeError("Entity must be a valid SshAssetEntity");
    }
    return {
      id: entity.id,
      name: entity.label,
      key_name: entity.keyName,
      counter: entity.counter,
      comment: entity.comment,
      updated_at: entity.updatedAt,
      created_at: entity.createdAt,
      tombstoned: entity.tombstoned,
      ...(entity.extra || {}),
    };
  }

  /**
   * Legacy Converter: WalletEntry <-> WalletAssetEntity
   */
  function fromLegacyWallet(wallet = {}) {
    const extra = { ...wallet };
    return createWalletEntity({
      id: wallet.id,
      label: wallet.label || wallet.wallet_name || wallet.wallet_id || "Wallet",
      walletId: wallet.wallet_id || wallet.walletId || wallet.wallet_name,
      words: wallet.words,
      counter: wallet.counter,
      notes: wallet.notes,
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at,
      frecency: wallet.frecency,
      tombstoned: wallet.tombstoned,
      extra,
    });
  }

  function toLegacyWallet(entity) {
    if (!entity || entity.kind !== AssetKind.WALLET) {
      throw new TypeError("Entity must be a valid WalletAssetEntity");
    }
    const extra = { ...(entity.extra || {}) };
    return {
      id: entity.id,
      wallet_id: entity.walletId,
      wallet_name: entity.walletId,
      label: entity.label,
      words: entity.words,
      counter: entity.counter,
      notes: entity.notes || "",
      updated_at: entity.updatedAt,
      created_at: entity.createdAt,
      tombstoned: entity.tombstoned,
      ...extra,
    };
  }

  /**
   * Polyglot Collection Ingestion: { services, ssh_keys, wallets } -> AssetEntity[]
   */
  function toUnifiedCollection(legacyCollections = {}) {
    const result = [];
    const services = Array.isArray(legacyCollections.services) ? legacyCollections.services : [];
    const sshKeys = Array.isArray(legacyCollections.ssh_keys) ? legacyCollections.ssh_keys : [];
    const wallets = Array.isArray(legacyCollections.wallets) ? legacyCollections.wallets : [];

    for (const s of services) {
      if (s) result.push(fromLegacyService(s));
    }
    for (const k of sshKeys) {
      if (k) result.push(fromLegacySshKey(k));
    }
    for (const w of wallets) {
      if (w) result.push(fromLegacyWallet(w));
    }

    return result;
  }

  /**
   * Polyglot Collection Egress: AssetEntity[] -> { services, ssh_keys, wallets }
   */
  function fromUnifiedCollection(entities = []) {
    const services = [];
    const ssh_keys = [];
    const wallets = [];

    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (!entity) continue;
        if (entity.kind === AssetKind.LOGIN) {
          services.push(toLegacyService(entity));
        } else if (entity.kind === AssetKind.SSH) {
          ssh_keys.push(toLegacySshKey(entity));
        } else if (entity.kind === AssetKind.WALLET) {
          wallets.push(toLegacyWallet(entity));
        }
      }
    }

    return { services, ssh_keys, wallets };
  }

  const KeygrainAssetEntity = Object.freeze({
    AssetKind,
    DerivationSource,
    createLoginEntity,
    createSshEntity,
    createWalletEntity,
    createGenericEntity,
    validateEntity,
    toMetadataDescriptor,
    matchesAutofill,
    fromLegacyService,
    toLegacyService,
    fromLegacySshKey,
    toLegacySshKey,
    fromLegacyWallet,
    toLegacyWallet,
    toUnifiedCollection,
    fromUnifiedCollection,
    generateUUID,
  });

  root.AssetKind = AssetKind;
  root.DerivationSource = DerivationSource;
  root.createLoginEntity = createLoginEntity;
  root.createSshEntity = createSshEntity;
  root.createWalletEntity = createWalletEntity;
  root.createGenericEntity = createGenericEntity;
  root.validateEntity = validateEntity;
  root.toMetadataDescriptor = toMetadataDescriptor;
  root.matchesAutofill = matchesAutofill;
  root.fromLegacyService = fromLegacyService;
  root.toLegacyService = toLegacyService;
  root.fromLegacySshKey = fromLegacySshKey;
  root.toLegacySshKey = toLegacySshKey;
  root.fromLegacyWallet = fromLegacyWallet;
  root.toLegacyWallet = toLegacyWallet;
  root.toUnifiedCollection = toUnifiedCollection;
  root.fromUnifiedCollection = fromUnifiedCollection;
  root.KeygrainAssetEntity = KeygrainAssetEntity;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = KeygrainAssetEntity;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
