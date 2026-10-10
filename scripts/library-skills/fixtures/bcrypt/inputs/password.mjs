export function validatePassword(password) {
  if (typeof password !== "string")
    throw new TypeError("Password must be a string");
  if (Buffer.byteLength(password, "utf8") > 72)
    throw new RangeError("Password exceeds bcrypt's 72-byte limit");
  return password;
}
