import { findUser } from "./repository.js";

export async function readUser(id: string): Promise<string> {
  const user = await findUser(id);
  return user.name;
}
