export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const value = await request.json();
      if (typeof value.title !== "string")
        return Response.json({ error: "title" }, { status: 400 });
      await env.CACHE.put("message", value.title);
      return Response.json(
        { saved: value.title, mode: env.MODE },
        { status: 201 },
      );
    }
    const title = await env.CACHE.get("message");
    if (title === null) return new Response("Missing", { status: 404 });
    return Response.json({ title, mode: env.MODE });
  },
};
