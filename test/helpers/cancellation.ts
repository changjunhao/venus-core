// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/** 显式同步测试阶段，不依赖 sleep 猜测执行进度。 */
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** 仅作失败保护，不作为取消时序断言。 */
export async function watchdog<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('取消测试等待超时')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
