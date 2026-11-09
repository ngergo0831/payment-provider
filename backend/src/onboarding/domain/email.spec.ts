import { normalizeEmail } from "./email";

describe("normaliseEmail", () => {
  it.each([
    ["Jane@Acme.Example", "jane@acme.example"],
    ["  jane@acme.example  ", "jane@acme.example"],
    ["\tJANE@ACME.EXAMPLE\n", "jane@acme.example"],
    ["already@normal.example", "already@normal.example"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" MiXeD@Case.EXAMPLE ");
    expect(normalizeEmail(once)).toBe(once);
  });
});
