# GitHub Migration & History Rewrite Plan

## Overview

Two tasks:
1. **Rewrite git history** — squash 237 commits into natural-looking weekend/holiday commits
2. **Publish to GitHub** — as a public mirror (CI/deploy stays on GitLab)

---

## Part 1: History Rewrite

### Why it's needed
The current 237 commits have timestamps from rapid development sessions (multiple commits per hour, weekday patterns). The goal is a cleaner history that looks like organic weekend/hobby development.

### Strategy: Interactive Rebase with Date Override

#### Step 1: Create a fresh working branch
```bash
cd /home/ibadrani/Projects/personal/keygrain
git checkout -b github-clean
```

#### Step 2: Plan the commit groups
Group related commits into logical units. Each final commit should represent one feature or meaningful change. Target: ~15-30 commits total.

Suggested groupings:
- Initial project setup + Python core algorithm
- SPEC.md + test vectors
- Browser extension (popup, autofill, crypto)
- Sync system (client + server)
- TOTP derivation
- SSH key derivation
- Wallet/BIP-85 derivation
- Android app (Kotlin)
- Migration wizard
- Breach warnings + site rules
- Web generator (PWA)
- Server deploy + rate limiting
- CI/CD pipeline
- Version display feature
- Documentation + website
- Store listings + final polish

#### Step 3: Squash commits using interactive rebase
```bash
# Rebase all commits (from root)
git rebase -i --root

# In the editor: mark commits as 'squash' or 'fixup' to merge them
# Keep 'pick' for the ones that become final commits
```

#### Step 4: Rewrite dates
After squashing, assign new dates to each commit. Use `git filter-branch` or `git rebase` with `--committer-date-is-author-date`:

```bash
# For each commit, amend with a specific date:
GIT_COMMITTER_DATE="2025-11-15T14:30:00+01:00" git commit --amend --date="2025-11-15T14:30:00+01:00" --no-edit
```

Or use a script to batch-rewrite all dates:
```bash
#!/bin/bash
# dates.txt: one ISO date per line, one per commit (oldest first)
# Run after squashing, with commits in order

i=0
git filter-branch --env-filter '
  dates=("2025-11-15T14:30:00+01:00" "2025-11-23T10:15:00+01:00" ...)
  export GIT_AUTHOR_DATE="${dates[$GIT_COMMIT_INDEX]}"
  export GIT_COMMITTER_DATE="${dates[$GIT_COMMIT_INDEX]}"
  GIT_COMMIT_INDEX=$((GIT_COMMIT_INDEX + 1))
' --tag-name-filter cat -- --all
```

**Better approach — `git-filter-repo`:**
```bash
pip install git-filter-repo

# Create a date mapping file and use a callback
git filter-repo --commit-callback '
  # Python callback to assign dates per commit
  import datetime
  dates = [...]  # list of timestamps
  commit.author_date = dates[commit_index].encode()
  commit.committer_date = dates[commit_index].encode()
'
```

#### Step 5: Choose realistic dates
Rules for natural-looking history:
- **Only weekends** (Saturday/Sunday) and **German public holidays**
- Vary times: morning (9-12), afternoon (14-17), evening (20-23)
- Never the same minute for consecutive commits
- Space commits 1-4 weeks apart
- Start date: ~Nov 2025 (gives 7 months of development)
- End date: Jun 2026 (now)
- 2-3 commits on the same weekend is fine (productive session)

#### Step 6: Verify the result
```bash
git log --format="%ad %s" --date=format:"%a %Y-%m-%d %H:%M"
# Verify: all dates are Sat/Sun or holidays
# Verify: reasonable time gaps between commits
```

---

## Part 2: GitHub Migration

### What makes this project "not GitHub compatible"

| Feature | Currently | GitHub equivalent |
|---------|-----------|-------------------|
| CI/CD | `.gitlab-ci.yml` | GitHub Actions (`.github/workflows/`) |
| Package registry | GitLab generic packages | GitHub Packages or Releases |
| Deploy | SSH from GitLab CI runner | SSH from GitHub Actions runner |
| Secret variables | GitLab CI/CD variables | GitHub Actions secrets |
| Merge requests | GitLab MRs | Pull requests |

### Decision: GitHub as PUBLIC MIRROR only

Keep GitLab as the primary (CI, deploy, development). GitHub is for:
- Public visibility + star count + discoverability
- "Open source" proof that anyone can verify
- LinkedIn link target (github.com > dev.secbytech.com for trust)

### Step 1: Create GitHub repo
```bash
# Create on github.com (public, no README, no .gitignore)
# Name: keygrain (or ibadrani/keygrain)
```

### Step 2: Add GitHub as second remote
```bash
git remote add github git@github.com:ibadrani/keygrain.git
```

### Step 3: Push the clean history
```bash
git push github github-clean:main
```

### Step 4: Update all source code links
Replace `dev.secbytech.com/opensource/keygrain` with `github.com/ibadrani/keygrain` in:

| File | Count of references |
|------|---------------------|
| `README.md` | 1 |
| `python/README.md` | 2 |
| `python/pyproject.toml` | 2 |
| `HANDOVER.md` | 1 |
| `extension/store/chrome-listing.md` | 1 |
| `extension/store/firefox-listing.md` | 1 |
| `server/static/privacy.html` | 1 |
| `server/static/compare/index.html` | 1 |
| `server/static/guide/index.html` | 1 |
| `server/static/terms/index.html` | 2 |
| `server/static/security/index.html` | 2 |

**One-liner to replace all:**
```bash
find . -type f \( -name "*.md" -o -name "*.toml" -o -name "*.html" \) \
  -not -path "./.git/*" \
  -exec sed -i 's|https://dev.secbytech.com/opensource/keygrain|https://github.com/ibadrani/keygrain|g' {} +

# Also fix the git+ssh install URL in README.md:
sed -i 's|git+ssh://git@dev.secbytech.com/opensource/keygrain.git|https://github.com/ibadrani/keygrain.git|' README.md
```

### Step 5: Add GitHub Actions CI (optional, for badge credibility)
Create `.github/workflows/test.yml` — run tests only (no deploy):
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: cd python && pip install -e . && pip install pytest && pytest -q

  test-js:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd extension/tests && node test.mjs

  test-go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: cd server && go test ./...
```

### Step 6: Add GitHub-specific files
```bash
# Repository description (set via GitHub UI):
# "Deterministic password manager. No vault, no database, nothing to breach."

# Topics/tags (set via GitHub UI):
# password-manager, cryptography, argon2, security, privacy, browser-extension, android
```

### Step 7: Ongoing sync (manual or automated)
After the initial push, keep GitHub in sync:
```bash
# After each release on GitLab:
git push github main
```

Or automate in `.gitlab-ci.yml`:
```yaml
mirror-github:
  stage: deploy
  script:
    - git push github HEAD:main
  only:
    - master
```

---

## Part 3: Files to EXCLUDE from GitHub

These should NOT be on GitHub (add to `.gitignore` or remove before push):

- `.gitlab-ci.yml` — **KEEP** (shows CI exists, not harmful)
- `.kiro/` — already gitignored
- `HANDOVER.md` — remove if it contains internal processes
- Any deploy credentials or `.env` files — already gitignored

---

## Execution Order

1. [ ] Verify dev.secbytech.com repo is publicly accessible (5 min)
2. [ ] Create GitHub account/repo (github.com/ibadrani/keygrain)
3. [ ] Create `github-clean` branch from current master
4. [ ] Plan commit groups (map 237 commits → ~20 squashed commits)
5. [ ] Interactive rebase to squash
6. [ ] Assign weekend/holiday dates to each commit
7. [ ] Verify dates look natural (`git log`)
8. [ ] Push clean branch to GitHub as `main`
9. [ ] Update all source code links (sed one-liner)
10. [ ] Add `.github/workflows/test.yml`
11. [ ] Push link updates to both GitLab and GitHub
12. [ ] Deploy updated website (with GitHub links)
13. [ ] Verify GitHub repo is public and CI badge is green
14. [ ] Update Chrome/Firefox store listings with GitHub link
15. [ ] Post on LinkedIn
