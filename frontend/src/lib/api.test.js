jest.mock("axios", () => ({
  create: () => ({ interceptors: { request: { use: jest.fn() } } }),
}));

import { apiError } from "./api";

test("preserves backend validation errors", () => {
  expect(apiError({ response: { data: { detail: "Email already exists" } } })).toBe("Email already exists");
});

test("explains an unreachable backend in English and Hindi", () => {
  const message = apiError({ request: {}, message: "Network Error" });
  expect(message).toContain("Cannot connect to WorkForce server");
  expect(message).toContain("Server से connection नहीं हो पा रहा है");
});
