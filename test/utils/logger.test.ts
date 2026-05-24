// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect, mock, afterEach } from 'bun:test';
import { createLogger } from '../../src/utils/logger.js';

describe('Logger', () => {
  describe('createLogger()', () => {
    afterEach(() => {
      mock.restore();
    });

    it('should return an object with debug/info/warn/error methods', () => {
      const logger = createLogger('test');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should use default prefix @theogony/venus-core when none provided', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.info = spy as unknown as typeof console.info;

      const logger = createLogger();
      logger.info('test');

      expect(spy).toHaveBeenCalled();
      const callArg = spy.mock.calls[0]?.[0] as string | undefined;
      expect(callArg).toContain('[@theogony/venus-core]');
    });

    it('should format messages with prefix and level', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.info = spy as unknown as typeof console.info;

      const logger = createLogger('my-app');
      logger.info('hello world');

      expect(spy).toHaveBeenCalled();
      const callArg = spy.mock.calls[0]?.[0] as string | undefined;
      expect(callArg).toBeDefined();
      expect(callArg).toContain('[my-app]');
      expect(callArg).toContain('[INFO]');
      expect(callArg).toContain('hello world');
    });

    it('should format debug level correctly', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.debug = spy as unknown as typeof console.debug;

      const logger = createLogger('test');
      logger.debug('debug message');

      const callArg = spy.mock.calls[0]?.[0] as string | undefined;
      expect(callArg).toContain('[DEBUG]');
    });

    it('should format warn level correctly', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.warn = spy as unknown as typeof console.warn;

      const logger = createLogger('test');
      logger.warn('warning message');

      const callArg = spy.mock.calls[0]?.[0] as string | undefined;
      expect(callArg).toContain('[WARN]');
    });

    it('should format error level correctly', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.error = spy as unknown as typeof console.error;

      const logger = createLogger('test');
      logger.error('error message');

      const callArg = spy.mock.calls[0]?.[0] as string | undefined;
      expect(callArg).toContain('[ERROR]');
    });

    it('should pass additional arguments through', () => {
      const spy = mock((_msg: string, ..._args: unknown[]) => {});
      console.info = spy as unknown as typeof console.info;

      const logger = createLogger('test');
      logger.info('message', { detail: 'extra' }, 42);

      expect(spy).toHaveBeenCalled();
      const args = spy.mock.calls[0];
      expect(args).toBeDefined();
      expect(args!).toHaveLength(3);
      expect(args![1]).toEqual({ detail: 'extra' });
      expect(args![2]).toBe(42);
    });
  });
});
