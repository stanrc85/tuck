import { describe, it, expect } from 'vitest';
import {
  interpolate,
  detectPlatformVars,
  type BootstrapVars,
} from '../../src/lib/bootstrap/interpolator.js';
import { BootstrapError } from '../../src/errors.js';

const baseVars: BootstrapVars = {
  VERSION: '1.2.3',
  ARCH: 'amd64',
  HOME: '/home/alice',
  OS: 'linux',
  TUCK_DIR: '/home/alice/.tuck',
};

describe('interpolate', () => {
  it('substitutes every known variable', () => {
    const tpl =
      'curl -fsSL .../v${VERSION}/pet_${VERSION}_${OS}_${ARCH}.deb -o ${HOME}/pet.deb ; ls ${TUCK_DIR}';
    expect(interpolate(tpl, baseVars)).toBe(
      'curl -fsSL .../v1.2.3/pet_1.2.3_linux_amd64.deb -o /home/alice/pet.deb ; ls /home/alice/.tuck'
    );
  });

  it('leaves unknown ${...} tokens untouched (shell vars pass through)', () => {
    // ${PATH}, ${USER}, ${HOME_SUFFIX} are not in our known set — must survive
    // so the shell can expand them at run time.
    const tpl = 'export PATH=$PATH:${TUCK_DIR}/bin; echo ${USER} on ${HOME_SUFFIX}';
    expect(interpolate(tpl, baseVars)).toBe(
      'export PATH=$PATH:/home/alice/.tuck/bin; echo ${USER} on ${HOME_SUFFIX}'
    );
  });

  it('returns the input unchanged when no known tokens appear', () => {
    expect(interpolate('echo hello', baseVars)).toBe('echo hello');
  });

  it('substitutes repeated tokens independently', () => {
    expect(interpolate('${VERSION}-${VERSION}-${VERSION}', baseVars)).toBe('1.2.3-1.2.3-1.2.3');
  });

  it('throws BootstrapError when ${VERSION} is used but the tool has no version', () => {
    const { VERSION: _unused, ...rest } = baseVars;
    void _unused;
    const vars = rest as BootstrapVars;
    expect(() => interpolate('download v${VERSION}', vars)).toThrowError(BootstrapError);
  });

  it("error for missing ${VERSION} suggests adding `version`", () => {
    const { VERSION: _unused, ...rest } = baseVars;
    void _unused;
    try {
      interpolate('v${VERSION}', rest as BootstrapVars);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BootstrapError);
      expect((err as BootstrapError).suggestions?.[0]).toMatch(/version/i);
    }
  });

  it('does not expand $NAME (bare dollar) or $(cmd) substitution', () => {
    // `pure string substitution — no arbitrary expansion` per the ticket.
    const tpl = 'echo $VERSION and $(uname -m) and $HOME';
    expect(interpolate(tpl, baseVars)).toBe('echo $VERSION and $(uname -m) and $HOME');
  });

  it('literal ${UNKNOWN} tokens remain exact — no regex escaping surprises', () => {
    expect(interpolate('${FOO.BAR}', baseVars)).toBe('${FOO.BAR}');
  });
});

describe('detectPlatformVars', () => {
  it('returns the four platform-derived variables with non-empty values', () => {
    const vars = detectPlatformVars();
    expect(vars.ARCH).toBeTruthy();
    expect(vars.HOME).toBeTruthy();
    expect(vars.OS).toBeTruthy();
    expect(vars.TUCK_DIR).toBeTruthy();
  });

  it('OS is normalized to a short name (no win32)', () => {
    const { OS } = detectPlatformVars();
    expect(OS).not.toBe('win32');
    expect(['linux', 'darwin', 'windows', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(OS);
  });

  it('ARCH is normalized to Debian-style on common machines', () => {
    const { ARCH } = detectPlatformVars();
    // Node's `x64` must be remapped; `arm64` / `armhf` pass through.
    expect(ARCH).not.toBe('x64');
  });
});
