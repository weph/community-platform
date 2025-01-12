export default {
  collectCoverage: true,
  coverageDirectory: "coverage",
  testEnvironment: "node",
  transform: {
    "^.+\\.[tj]sx?$": "babel-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/jest-setup.ts"],
  moduleNameMapper: {
    "^~/(.*)": "<rootDir>/app/$1",
    "\\.css$": "<rootDir>/__mocks__/styleMock.js",
  },
  testPathIgnorePatterns: ["<rootDir>/app/components"],
};
