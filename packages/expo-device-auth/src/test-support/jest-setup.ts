const originalConsoleError = console.error;

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation((...args) => {
    const [firstArg] = args;
    if (
      typeof firstArg === "string" &&
      firstArg.includes("react-test-renderer is deprecated")
    ) {
      return;
    }

    originalConsoleError(...args);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});
