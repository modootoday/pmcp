export async function findUser(
  id: string,
): Promise<{ id: string; name: string }> {
  throw new Error(`No repository configured for ${id}`);
}
