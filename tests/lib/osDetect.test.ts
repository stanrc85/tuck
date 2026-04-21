import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const readFileMock = vi.fn();

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
}));

describe('detectOsGroup', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns kali for Kali 2024.x os-release', async () => {
    readFileMock.mockResolvedValueOnce(`NAME="Kali GNU/Linux"\nID=kali\nVERSION="2024.3"\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBe('kali');
  });

  it('returns kali regardless of version (2024 or 2025)', async () => {
    readFileMock.mockResolvedValueOnce(`ID=kali\nVERSION="2025.1"\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBe('kali');
  });

  it('returns ubuntu for Ubuntu LTS', async () => {
    readFileMock.mockResolvedValueOnce(`ID=ubuntu\nVERSION="24.04 LTS"\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBe('ubuntu');
  });

  it('handles quoted ID values', async () => {
    readFileMock.mockResolvedValueOnce(`ID="debian"\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBe('debian');
  });

  it('returns null for unknown distro (manjaro)', async () => {
    readFileMock.mockResolvedValueOnce(`ID=manjaro\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBeNull();
  });

  it('returns null on non-Linux (darwin)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBeNull();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('returns null on non-Linux (win32)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBeNull();
  });

  it('returns null when /etc/os-release is missing', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT'));
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBeNull();
  });

  it('returns null when /etc/os-release has no ID field', async () => {
    readFileMock.mockResolvedValueOnce(`NAME="Mystery Linux"\nVERSION=1.0\n`);
    const { detectOsGroup } = await import('../../src/lib/osDetect.js');
    expect(await detectOsGroup()).toBeNull();
  });
});
