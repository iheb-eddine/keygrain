"""Tests for SSH key derivation. Vectors from the public SSH-key specification."""

import pytest
from keygrain.ssh import derive_ssh_keypair, format_openssh_private_key, format_authorized_keys


VECTORS = [
    {
        "secret": b"my-master-secret",
        "key_name": "github",
        "counter": 1,
        "seed_hex": "54b4a6dc5d9d1147fcd50f7263ffeedb50b05b40de553105d552805a3fd09864",
        "pubkey_hex": "dd030383ed8e7b36807de678341bdab0606d17336ff64bf66f46c1129649b011",
    },
    {
        "secret": b"my-master-secret",
        "key_name": "work-servers",
        "counter": 1,
        "seed_hex": "a77682dd0cadb362f5a44386852ac656b393084b329c3bdfde26add8fc9f5bec",
        "pubkey_hex": "54013af1906b69aae548396f7fbb800192ed2a95004b18c4df633f534fae4e9b",
    },
    {
        "secret": b"my-master-secret",
        "key_name": "github",
        "counter": 2,
        "seed_hex": "ee2e85f222e76d15199135343db824f9dbe125c8c7fde1fda3cdaaf2a678397d",
        "pubkey_hex": "11fd80f28700727f93747de4e155cbff49da466787b3ac88c1efd17f39f7ad99",
    },
    {
        "secret": b"my-master-secret",
        "key_name": "GitHub",
        "counter": 1,
        "seed_hex": "54b4a6dc5d9d1147fcd50f7263ffeedb50b05b40de553105d552805a3fd09864",
        "pubkey_hex": "dd030383ed8e7b36807de678341bdab0606d17336ff64bf66f46c1129649b011",
    },
    {
        "secret": b"different-secret",
        "key_name": "github",
        "counter": 1,
        "seed_hex": "cb771f4b0f6cd599b29425e10ee41c43256b88d507d98a7d98242b4f6e4b5bca",
        "pubkey_hex": "f619687a9a572525ceb162d2d21f44609cc07eff4198b23edbe727eaac025c14",
    },
]

AUTHORIZED_KEYS_VECTORS = [
    (0, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN0DA4Ptjns2gH3meDQb2rBgbRczb/ZL9m9GwRKWSbAR github"),
    (1, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFQBOvGQa2mq5Ug5b3+7gAGS7SqVAEsYxN9jP1NPrk6b work-servers"),
    (2, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBH9gPKHAHJ/k3R95OFVy/9J2kZnh7OsiMHv0X85962Z github"),
    (4, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPYZaHqaVyUlzrFi0tIfRGCcwH7/QZiyPtvnJ+qsAlwU github"),
]


class TestDeriveSshKeypair:
    @pytest.mark.parametrize("v", VECTORS, ids=[f"vector_{i+1}" for i in range(len(VECTORS))])
    def test_derivation_vectors(self, v):
        seed, pubkey = derive_ssh_keypair(
            v["secret"], key_name=v["key_name"], counter=v["counter"]
        )
        assert seed.hex() == v["seed_hex"]
        assert pubkey.hex() == v["pubkey_hex"]

    def test_case_normalization(self):
        """Vectors 1 and 4 must produce identical output."""
        s1, p1 = derive_ssh_keypair(b"my-master-secret", key_name="github", counter=1)
        s4, p4 = derive_ssh_keypair(b"my-master-secret", key_name="GitHub", counter=1)
        assert s1 == s4
        assert p1 == p4

    def test_empty_key_name_rejected(self):
        with pytest.raises(ValueError, match="empty"):
            derive_ssh_keypair(b"secret", key_name="", counter=1)

    def test_whitespace_key_name_rejected(self):
        with pytest.raises(ValueError, match="whitespace"):
            derive_ssh_keypair(b"secret", key_name="my key", counter=1)

    def test_counter_zero_rejected(self):
        with pytest.raises(ValueError, match="counter"):
            derive_ssh_keypair(b"secret", key_name="test", counter=0)


class TestFormatAuthorizedKeys:
    @pytest.mark.parametrize("idx,expected", AUTHORIZED_KEYS_VECTORS)
    def test_authorized_keys_vectors(self, idx, expected):
        v = VECTORS[idx]
        _, pubkey = derive_ssh_keypair(
            v["secret"], key_name=v["key_name"], counter=v["counter"]
        )
        comment = v["key_name"].lower()
        result = format_authorized_keys(pubkey, comment)
        assert result == expected


class TestFormatOpensshPrivateKey:
    def test_pem_structure(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "github")
        assert pem.startswith("-----BEGIN OPENSSH PRIVATE KEY-----\n")
        assert pem.endswith("-----END OPENSSH PRIVATE KEY-----\n")

    def test_pem_line_length(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "github")
        lines = pem.split("\n")
        # Check base64 lines (not header/footer/empty)
        for line in lines[1:-2]:
            assert len(line) <= 70

    def test_pem_deterministic(self):
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", key_name="github", counter=1
        )
        pem1 = format_openssh_private_key(seed, pubkey, "github")
        pem2 = format_openssh_private_key(seed, pubkey, "github")
        assert pem1 == pem2

    def test_pem_parseable_by_ssh(self):
        """Verify the PEM contains valid OpenSSH structure."""
        import base64
        seed, pubkey = derive_ssh_keypair(
            b"my-master-secret", key_name="github", counter=1
        )
        pem = format_openssh_private_key(seed, pubkey, "github")
        # Extract base64 content
        lines = pem.strip().split("\n")
        b64_content = "".join(lines[1:-1])
        blob = base64.b64decode(b64_content)
        # Verify AUTH_MAGIC
        assert blob[:15] == b"openssh-key-v1\x00"
