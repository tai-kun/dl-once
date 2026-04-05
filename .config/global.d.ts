declare const __DEBUG__: boolean;

// `Array.isArray` の型絞り込み機能を強化します。
// @ts-ignore
declare module globalThis {
  interface ArrayConstructor {
    isArray(arg: readonly any[] | any): arg is readonly any[];
  }
}
