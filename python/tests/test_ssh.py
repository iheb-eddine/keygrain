"""Tests for SSH key derivation. Vectors from designs/ssh-key-derivation.md §10."""

import pytest
from keygrain.ssh import derive_ssh_keypair, format_openssh_private_key, format_authorized_keys


VECTORS = [
    {
        "secret": b"my-master-secret",
        "email": "test@gmail.com",
        "key_name": "github",
        "counter": 1,
        "seed_hex": "15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1",
        "pubkey_hex": "f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032",
    },
    {
        "secret": b"my-master-secret",
        "email": "test@gmail.com",
        "key_name": "work-servers",
        "counter": 1,
        "seed_hex": "d415ea7afd4b8e113bee60f42ae84b387b564f38e8b95a0c3326b3720d5fb9f0",
        "pubkey_hex": "5050a666581b46ebd076f5f902eaaa14a2dc7b14bdeada5fae5c861e049530e0",
    },
    {
        "secret": b"my-master-secret",
        "email": "test@gmail.com",
        "key_name": "github",
        "counter": 2,
        "seed_hex": "657c26252e9b425f83f5fd763177b75ea7046b4f9167a2116f248c19455ab9e2",
        "pubkey_hex": "1d921af7c1c68c75100e741008e903a28b14fc42fce5c0e33803f1cb3bbed16a",
    },
    {
        "secret": b"my-master-secret",
        "email": "TEST@Gmail.com",
        "key_name": "GitHub",
        "counter": 1,
        "seed_hex": "15d7cd5c74358c1cd7f7f93ef45d074afcf6fd9e008a94de9e8608a330d96dc1",
        "pubkey_hex": "f2aadbd608703b65bb87d3d1c746c48dfed9095a2b7ae4c8ada057afa6bf9032",
    },
    {
        "secret": b"different-secret",
        "email": "test@gmail.com",
        "key_name": "github",
        "counter": 1,
        "seed_hex": "247c4840e93dd75558b52c3979ed67420de5093f22fb1cdd74e86202d1f17e99",
        "pubkey_hex": "60efc824475a7a03dfba1bfc6abc49c4d4156bd705872fcf5615b00d210999ba",
    },
]

AUTHORIZED_KEYS_VECTORS = [
    (0, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPKq29YIcDtlu4fT0cdGxI3+2QlaK3rkyK2gV6+mv5Ay test@gmail.com:github"),
    (1, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFBQpmZYG0br0Hb1+QLqqhSi3HsUveraX65chh4ElTDg test@gmail.com:work-servers"),
    (2, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB2SGvfBxox1EA50EAjpA6KLFPxC/OXA4zgD8cs7vtFq test@gmail.com:github"),
    (4, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGDvyCRHWnoD37ob/Gq8ScTUFWvXBYcvz1YVsA0hCZm6 test@gmail.com:github"),
]


class TestDeriveSshKeypair:
    @pytest.mark.parametrize("v", VECTORS, ids=[f"vector_{i+1}" for i in range(len(VECTORS))])
    def test_derivation_vectors(self, v):
        seed, pubkey = derive_ssh_keypair(
            v["secret"], v["email"], key_name=v["key_name"], counter=v["counter"]
        )
        assert seed.hex() == v["seed_hex"]
        assert pubkey.hex() == v["pubkey_hex"]

    def test_case_normalization(self):
        """Vectors 1 and 4 must produce identical output."""
        s1, p1 = derive_ssh_keypair(b"my-master-secret", "test@gmail.com", key_name="github", counter=1)
        s4, p4 = derive_ssh_keypair(b"my-master-secret", "TEST@Gmail.com", key_name="GitHub", counter=1)
        assert s1 == s4
        assert p1 == p4

    def test_empty_key_name_rejected(self):
        with pytest.raises(ValueError, match="empty"):
            derive_ssh_keypair(b"secret", "a@b.com", key_name="", counter=1)

    def test_whitespace_key_name_rejected(self):
        with pytest.raises(ValueError, match="whitespace"):
            derive_ssh_keypair(b"secret", "a@b.com", key_name="my key", counter=1)

    def test_counter_zero_rejected(self):
        with pytest.raises(ValueError, match="counter"):
            derive_ssh_keypair(b"secret", "a@b.com", key_name="test", counter=0)


class TestFormatAuthorizedKeys:
    @pytest.mark.parametrize("idx,expected", AUTHORIZED_KEYS_VECTORS)
    def test_authorized_keys_vectors(self, idx, expected):
        v = VECTORS[idx]
        _, pubkey = derive_ssh_keypair(
            v["secret"], v["email"], key_name=v["key_name"], counter=v["counter"]
        )
        comment = f"{v['email'].lower()}:{v['key_name'].lower()}"
        result = format_authorized_keys(pubkey, comment)
        assert result == expected


class TestFormatOpensshPrivateKey:
    def test_pem_structure(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", "test@gmail.com", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "test@gmail.com:github")
        assert pem.startswith("-----BEGIN OPENSSH PRIVATE KEY-----\n")
        assert pem.endswith("-----END OPENSSH PRIVATE KEY-----\n")

    def test_pem_line_length(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", "test@gmail.com", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "test@gmail.com:github")
        lines = pem.split("\n")
        # Check base64 lines (not header/footer/empty)
        for line in lines[1:-2]:
            assert len(line) <= 70

    def test_pem_deterministic(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", "test@gmail.com", key_name="github", counter=1
        )
        pem1 = format_openssh_private_key(seed, pubkey, "test@gmail.com:github")
        pem2 = format_openssh_private_key(seed, pubkey, "test@gmail.com:github")
        assert pem1 == pem2

    def test_pem_parseable_by_ssh(self):
        """Verify the PEM contains valid OpenSSH structure."""
        import base64
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", "test@gmail.com", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "test@gmail.com:github")
        # Extract base64 content
        lines = pem.strip().split("\n")
        b64_content = "".join(lines[1:-1])
        blob = base64.b64decode(b64_content)
        # Verify AUTH_MAGIC
        assert blob[:15] == b"openssh-key-v1\x00"
