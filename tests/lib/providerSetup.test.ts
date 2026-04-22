import { describe, it, expect } from 'vitest';
import { detectProviderFromUrl } from '../../src/lib/providerSetup.js';

describe('detectProviderFromUrl', () => {
  describe('github hosts', () => {
    it('detects canonical https github.com', () => {
      expect(detectProviderFromUrl('https://github.com/user/repo.git')).toBe('github');
    });

    it('detects scp-style ssh git@github.com', () => {
      expect(detectProviderFromUrl('git@github.com:user/repo.git')).toBe('github');
    });

    it('detects ssh:// git@github.com', () => {
      expect(detectProviderFromUrl('ssh://git@github.com/user/repo.git')).toBe('github');
    });

    it('treats subdomains of github.com as github (github enterprise pattern)', () => {
      expect(detectProviderFromUrl('https://api.github.com/user/repo.git')).toBe('github');
    });
  });

  describe('gitlab hosts', () => {
    it('detects canonical https gitlab.com', () => {
      expect(detectProviderFromUrl('https://gitlab.com/user/repo.git')).toBe('gitlab');
    });

    it('detects scp-style ssh git@gitlab.com', () => {
      expect(detectProviderFromUrl('git@gitlab.com:user/repo.git')).toBe('gitlab');
    });

    it('detects self-hosted gitlab via hostname substring', () => {
      expect(detectProviderFromUrl('https://gitlab.self-hosted.example/u/r.git')).toBe('gitlab');
    });

    it('detects scp-style ssh on self-hosted gitlab', () => {
      expect(detectProviderFromUrl('git@gitlab.internal.example:u/r.git')).toBe('gitlab');
    });
  });

  describe('attacker-controlled URL shapes', () => {
    it('does NOT route path-component github.com to github', () => {
      expect(detectProviderFromUrl('https://evil.example/github.com/fake.git')).toBe('custom');
    });

    it('does NOT route look-alike subdomain github.com.evil.example to github', () => {
      expect(detectProviderFromUrl('https://github.com.evil.example/x.git')).toBe('custom');
    });

    it('does NOT route path-component gitlab.com to gitlab', () => {
      expect(detectProviderFromUrl('https://evil.example/gitlab.com/fake.git')).toBe('custom');
    });

    it('does NOT route substring-only gitlab (e.g. digitlabs.example) to gitlab', () => {
      // Old substring match would have flagged this; label-based match rejects it.
      expect(detectProviderFromUrl('https://digitlabs.example/x.git')).toBe('custom');
    });

    it('does NOT route a userinfo-embedded github.com to github', () => {
      expect(detectProviderFromUrl('https://github.com@evil.example/x.git')).toBe('custom');
    });
  });

  describe('fallback behavior', () => {
    it('returns custom for a plain https host with no github/gitlab hint', () => {
      expect(detectProviderFromUrl('https://git.example.com/user/repo.git')).toBe('custom');
    });

    it('returns custom for unparseable input', () => {
      expect(detectProviderFromUrl('not a url at all')).toBe('custom');
    });

    it('returns custom for empty input', () => {
      expect(detectProviderFromUrl('')).toBe('custom');
    });
  });
});
