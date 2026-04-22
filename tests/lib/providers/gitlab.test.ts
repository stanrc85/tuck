import { describe, it, expect } from 'vitest';
import { GitLabProvider } from '../../../src/lib/providers/gitlab.js';

describe('GitLabProvider.validateUrl', () => {
  describe('gitlab.com (default host)', () => {
    const provider = new GitLabProvider();

    it('accepts canonical https url', () => {
      expect(provider.validateUrl('https://gitlab.com/user/repo.git')).toBe(true);
    });

    it('accepts scp-style ssh url', () => {
      expect(provider.validateUrl('git@gitlab.com:user/repo.git')).toBe(true);
    });

    it('accepts ssh:// form', () => {
      expect(provider.validateUrl('ssh://git@gitlab.com/user/repo.git')).toBe(true);
    });

    it('rejects http (not https)', () => {
      expect(provider.validateUrl('http://gitlab.com/user/repo.git')).toBe(false);
    });

    it('rejects unrelated host', () => {
      expect(provider.validateUrl('https://github.com/user/repo.git')).toBe(false);
    });

    it('rejects substring lookalike host', () => {
      expect(provider.validateUrl('https://evil-gitlab.com/user/repo.git')).toBe(false);
    });

    it('rejects path-component injection', () => {
      expect(provider.validateUrl('https://evil.example/gitlab.com/fake.git')).toBe(false);
    });

    it('rejects userinfo-embedded host', () => {
      expect(provider.validateUrl('https://gitlab.com@evil.example/repo.git')).toBe(false);
    });
  });

  describe('self-hosted gitlab', () => {
    const provider = new GitLabProvider('gitlab.internal.example');

    it('accepts https for self-hosted host', () => {
      expect(provider.validateUrl('https://gitlab.internal.example/team/repo.git')).toBe(true);
    });

    it('accepts ssh for self-hosted host', () => {
      expect(provider.validateUrl('git@gitlab.internal.example:team/repo.git')).toBe(true);
    });

    it('rejects gitlab.com when configured for self-hosted', () => {
      expect(provider.validateUrl('https://gitlab.com/user/repo.git')).toBe(false);
    });

    it('strips https:// and trailing slash from constructor host arg', () => {
      const normalized = new GitLabProvider('https://gitlab.internal.example/');
      expect(normalized.validateUrl('https://gitlab.internal.example/team/repo.git')).toBe(true);
    });
  });

  describe('hostile host inputs', () => {
    // These are the cases CodeQL #6 worried about — a host containing regex
    // metacharacters could have made the old `new RegExp(...)` match unintended
    // shapes. With startsWith there is no interpretation of the host string.
    it('treats trailing-dot host as a literal string match, not a regex', () => {
      const provider = new GitLabProvider('example.com.');
      expect(provider.validateUrl('https://example.com./repo.git')).toBe(true);
      expect(provider.validateUrl('https://example.comX/repo.git')).toBe(false);
    });

    it('treats a host with a regex metacharacter as a literal string', () => {
      // The constructor only strips protocol + trailing slash; other chars are kept
      // verbatim. With the old regex code, `[a-z]` would have been interpreted as
      // a character class. With startsWith it must match literally.
      const provider = new GitLabProvider('host[a-z].example');
      expect(provider.validateUrl('https://host[a-z].example/repo.git')).toBe(true);
      expect(provider.validateUrl('https://hosta.example/repo.git')).toBe(false);
    });
  });
});
