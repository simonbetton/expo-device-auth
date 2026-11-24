export const { clearAllMocks, resetModules } = jest;
export const mockFn = jest.fn;
export const { mocked } = jest;

export const deferred = <Result>() => {
  let resolveResult!: (result: Result) => void;
  // eslint-disable-next-line promise/avoid-new -- The test TypeScript target lacks Promise.withResolvers.
  const promise = new Promise<Result>((resolve) => {
    resolveResult = resolve;
  });
  return { promise, resolve: resolveResult };
};
