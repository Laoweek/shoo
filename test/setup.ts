// Vitest setup for every project. WxtVitest's own setup file (which stubs `browser` with the
// in-memory fakeBrowser) does not reach projects declared under `test.projects`, so do it here.
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

vi.stubGlobal('chrome', fakeBrowser);
vi.stubGlobal('browser', fakeBrowser);
