import { router } from "./routes.js";

void router.navigate({
  to: "/items/$itemId",
  params: { itemId: 42 },
  search: { page: 2 },
});
void router.navigate({ to: "/missing" });
